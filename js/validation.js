// js/validation.js
// Post-AI rule-based validations: fabric width/turn, colour, control config,
// motor torque, and motor-to-blind dependency checking.

import {
    BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK,
    BLIND_TYPES_REQUIRING_DUAL_CONTROL,
    BLIND_TYPES_REQUIRING_CONTROL_VALIDATION,
    BOTTOM_BAR_WEIGHT_KG_PER_M,
    GRAVITY,
} from './config.js';

export function runPostAIValidations(comparisonData, fabricProperties, motorProperties, tubeProperties) {
    if (!comparisonData) return comparisonData;

    if (comparisonData.lineItems) {
        comparisonData.lineItems.forEach(item => {

            // --- 1. Fabric Width & Drop Validation ---
            if (fabricProperties && fabricProperties.size > 0) {
                const fabricName  = item.range?.blindIQValue?.toLowerCase().trim();
                const widthString = item.width?.blindIQValue || '';
                const dropString  = item.drop?.blindIQValue  || '';
                const widthMatch  = widthString.match(/\d+/);
                const dropMatch   = dropString.match(/\d+/);
                const blindWidth  = widthMatch ? parseInt(widthMatch[0], 10) : NaN;
                const blindDrop   = dropMatch  ? parseInt(dropMatch[0],  10) : NaN;

                if (fabricName && (isNaN(blindWidth) || isNaN(blindDrop))) {
                    console.warn(`Fabric validation skipped for item ${item.item?.blindIQValue}: could not parse width ('${widthString}') or drop ('${dropString}').`);
                }

                if (fabricName && !isNaN(blindWidth) && !isNaN(blindDrop)) {
                    const props = fabricProperties.get(fabricName);
                    if (props) {
                        const fabricWidth = props.fabricWidth;
                        const canTurn     = props.canTurn.toLowerCase();
                        if (blindWidth > fabricWidth) {
                            if (canTurn === 'no') {
                                item.fabricValidation = { type: 'error', message: `Fabric Alert: Width (${blindWidth}mm) exceeds max fabric width (${fabricWidth}mm). Fabric cannot be turned.` };
                            } else if (canTurn === 'yes' || canTurn === 'out') {
                                if (blindDrop > fabricWidth) {
                                    item.fabricValidation = { type: 'error', message: `Fabric Alert: Drop (${blindDrop}mm) exceeds max turned width (${fabricWidth}mm). Blind cannot be made.` };
                                } else if (canTurn === 'out') {
                                    item.fabricValidation = { type: 'warning', message: `Fabric Alert: Width (${blindWidth}mm) exceeds fabric width (${fabricWidth}mm). Turning is Out of Warranty.` };
                                }
                            }
                        }
                    }
                }
            }

            // --- 2. Colour Validation ---
            const blindType = item.blindType?.blindIQValue?.toLowerCase().trim();
            const colour    = item.colour?.blindIQValue?.trim();
            if (blindType && !BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK.includes(blindType)) {
                if (!colour || colour === 'N/A' || colour === '-') {
                    item.colourValidation = { type: 'error', message: 'Colour Alert: No colour has been specified for this blind type.' };
                }
            }

            // --- 3. Control Configuration Validation ---
            const control1Value          = item.control1?.blindIQValue?.toLowerCase() || '';
            const control2Value          = item.control2?.blindIQValue?.toLowerCase() || '';
            const combinedControlValue   = control1Value + ' ' + control2Value;
            const blindTypeForControlCheck = item.blindType?.blindIQValue?.toLowerCase().trim();

            if (blindTypeForControlCheck && BLIND_TYPES_REQUIRING_DUAL_CONTROL.includes(blindTypeForControlCheck)) {
                if (!control1Value || !control2Value) {
                    item.controlValidation = { type: 'error', message: `Control Alert: Both Control columns must be populated for ${item.blindType.blindIQValue}.` };
                    if (!control1Value && item.control1) item.control1.result = 'MISMATCH';
                    if (!control2Value && item.control2) item.control2.result = 'MISMATCH';
                }
            }
            if (blindTypeForControlCheck && BLIND_TYPES_REQUIRING_CONTROL_VALIDATION.includes(blindTypeForControlCheck)) {
                const hasValidControl = combinedControlValue.includes('chain') || combinedControlValue.includes('motor') || combinedControlValue.includes('dual');
                if (!hasValidControl && !item.controlValidation) {
                    item.controlValidation = { type: 'error', message: "Control Alert: Invalid configuration. Each blind must have a 'chain', 'motor', or 'dual' control." };
                }
            }
        });
    }

    // --- 4. Motor & Sundries Validation ---
    if (motorProperties && motorProperties.length > 0 && comparisonData.sundries && tubeProperties) {
        validateMotorDependencies(comparisonData, motorProperties, tubeProperties, fabricProperties);
    }

    return comparisonData;
}

function validateMotorDependencies(data, motorProperties, tubeProperties, fabricProperties) {
    const motorizedBlinds = (data.lineItems || []).filter(item => {
        const control = ((item.control1?.blindIQValue || '') + ' ' + (item.control2?.blindIQValue || '')).toLowerCase();
        return control.includes('motor') || control.includes('dual');
    });

    if (motorizedBlinds.length === 0) return;

    const sundries = data.sundries || [];
    let orderedMotors = [];
    const orderedAdapters     = new Set();
    const orderedControllers  = new Set();
    const orderedAccessories  = new Set();
    const orderedDependencies = new Set();

    sundries.forEach(sundry => {
        const desc = sundry.item.blindIQValue.toLowerCase();
        const matchingProps = motorProperties.filter(prop => desc.includes(prop.motorName.toLowerCase()));
        if (matchingProps.length > 0 && desc.includes('motor')) {
            for (let i = 0; i < sundry.quantity; i++) {
                orderedMotors.push({ sundry, potentialProps: matchingProps, assignedBlind: null });
            }
        } else {
            if (desc.includes('adapter'))                                          orderedAdapters.add(sundry.item.blindIQValue);
            else if (desc.includes('remote') || desc.includes('switch') || desc.includes('hub')) orderedControllers.add(sundry.item.blindIQValue);
            else if (desc.includes('accessory'))                                   orderedAccessories.add(sundry.item.blindIQValue);
            else                                                                   orderedDependencies.add(sundry.item.blindIQValue);
        }
    });

    if (motorizedBlinds.length !== orderedMotors.length) {
        data.motorValidation = { global: `Motor Alert: Order has ${motorizedBlinds.length} motorized blinds but ${orderedMotors.length} motors were found in sundries. Validating matched pairs only.` };
    }

    motorizedBlinds.forEach(blind => {
        blind.calculatedArea = (parseInt(blind.width?.blindIQValue) / 1000) * (parseInt(blind.drop?.blindIQValue) / 1000);
    });
    motorizedBlinds.sort((a, b) => b.calculatedArea - a.calculatedArea);
    orderedMotors.sort((a, b) => Math.max(...b.potentialProps.map(p => p.torque)) - Math.max(...a.potentialProps.map(p => p.torque)));
    motorizedBlinds.forEach((blind, i) => { if (orderedMotors[i]) orderedMotors[i].assignedBlind = blind; });

    orderedMotors.forEach(motorObj => {
        const blind = motorObj.assignedBlind;
        if (!blind) return;

        const blindType    = blind.blindType.blindIQValue;
        const blindControl = ((blind.control1?.blindIQValue || '') + ' ' + (blind.control2?.blindIQValue || '')).toLowerCase().split(',').map(s => s.trim());
        const motorProp    = motorObj.potentialProps.find(p => p.blindType.toLowerCase().trim() === blindType.toLowerCase().trim());

        if (!blind.motorValidation) blind.motorValidation = [];

        if (!motorProp) {
            blind.motorValidation.push(`Motor Alert: No properties found for motor "${motorObj.potentialProps[0].motorName}" compatible with blind type "${blindType}".`);
            return;
        }

        // Torque Calculation
        const fabric = fabricProperties.get(blind.range.blindIQValue.toLowerCase().trim());
        const tube   = tubeProperties.get(blind.blindType.blindIQValue.toLowerCase().trim());
        if (fabric && tube) {
            const blindWidthM      = parseInt(blind.width.blindIQValue) / 1000;
            const blindDropM       = parseInt(blind.drop.blindIQValue)  / 1000;
            const fabricWeight     = blindWidthM * blindDropM * fabric.fabricWeight;
            const bottomBarWeight  = blindWidthM * BOTTOM_BAR_WEIGHT_KG_PER_M;
            const totalWeightKg    = fabricWeight + bottomBarWeight;
            const tubeRadiusM      = (tube.tubeDiameter / 1000) / 2;
            const requiredTorque   = parseFloat((totalWeightKg * GRAVITY * tubeRadiusM).toFixed(2));

            blind.requiredTorque = requiredTorque;

            if (motorProp.torque < requiredTorque) {
                blind.torqueValidation = { message: `Torque Alert: Motor's torque (${motorProp.torque} Nm) is insufficient for this blind's calculated required torque of ${requiredTorque} Nm.` };
            }
        }

        const checkListItem = (orderedItems, requiredItemsString) => {
            const requiredItems = (requiredItemsString || '').toLowerCase().split(',').map(s => s.trim()).filter(s => s);
            if (requiredItems.length === 0) return { pass: true };
            const foundItem = [...orderedItems].find(ordered => requiredItems.some(req => ordered.toLowerCase().includes(req)));
            return { pass: !!foundItem, found: foundItem };
        };

        const adapterCheck = checkListItem(orderedAdapters, motorProp.adapterKit);
        if (!adapterCheck.pass) blind.motorValidation.push(`Adapter Alert: Missing required adapter kit (e.g., "${motorProp.adapterKit}").`);

        const validBlindControls = (motorProp.blindControl || '').toLowerCase().split(',').map(s => s.trim());
        if (validBlindControls.length > 0 && !blindControl.some(c => validBlindControls.includes(c))) {
            blind.motorValidation.push(`Control Alert: Missing valid control for motor "${motorProp.motorName}". Valid options: [${motorProp.blindControl}]`);
        }

        const controllerCheck = checkListItem(orderedControllers, motorProp.controlOptions);
        if (!controllerCheck.pass) blind.motorValidation.push(`Controller Alert: No compatible controller (e.g., ${motorProp.controlOptions}) found in sundries.`);

        const accessories = (motorProp.accessories || '').toLowerCase().split(',').map(s => s.trim()).filter(s => s);
        if (accessories.length > 0) {
            const incompatibleAcc = [...orderedAccessories].find(ordered => !accessories.some(valid => ordered.toLowerCase().includes(valid)));
            if (incompatibleAcc) blind.motorValidation.push(`Accessory Alert: Incompatible accessory found: "${incompatibleAcc}". Valid options are: [${motorProp.accessories}]`);
        }

        const dependencyCheck = checkListItem(orderedDependencies, motorProp.otherDependencies);
        if (!dependencyCheck.pass) blind.motorValidation.push(`Dependency Alert: Missing required dependency (e.g., ${motorProp.otherDependencies}).`);

        if (blind.motorValidation.length === 0) delete blind.motorValidation;
    });
}
