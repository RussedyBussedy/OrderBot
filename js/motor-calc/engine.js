// motor-calc/engine.js
//
// Roller-blind torque and battery-autonomy calculation: the roller method of
// the motor-calc pack, which is written and kept outside this repository.
//
// Plain ES module: no imports, no DOM, no network, no data. Every function is pure.
// Units: metres, kilograms, newton-metres, volts, amps; energy in mWh.
// Object shapes are described in README.md.

// These are the exact values of 32-bit floats, kept so results match the pack's reference cases.
export const GRAVITY = 9.81000041962;
const FRICTION_TIMES_GRAVITY = 2.4525001049; // friction coefficient 0.25 x 9.81
const STEP_TURNS = 0.10000000149;            // the cycle is simulated in steps of 0.1 tube turn
const UNSIMULATED_TURNS = 1.5;               // the last 1.5 turns of travel are not simulated
const PI = 3.14159265359;
const TWO_PI = 6.28318530718;
const FOUR_PI = 12.5663706144;
const ALUMINIUM_KG_PER_M3 = 2700;
const TORQUE_EPSILON = 1e-8;

/** "RF traffic" levels: percentage of the day the receiver is kept awake by other radio products. */
export const RF_TRAFFIC_PCT = Object.freeze({ low: 0.02, medium: 0.16, high: 1, veryHigh: 10 });

// ---------------------------------------------------------------------------------------------
// Battery pack
// A pack is { cellsSeries, cellsParallel, dropV, cell }, with cell = { selfDischargePctPerYear, tables }.
// cell.tables holds four tables (0.1, 0.25, 0.5, 1 A), each with six rows { cutoffV, capacityAh, meanV }.
// ---------------------------------------------------------------------------------------------

// Value of `field` in one current table at a per-cell cut-off voltage (linear between rows, clamped at the ends).
function lookupAtCutoff(cell, cellCutoffV, field, tableIndex) {
  const rows = cell.tables[tableIndex].rows;
  let row = 0;
  if (cellCutoffV > rows[0].cutoffV) {
    while (row <= 5) {
      row += 1;
      if (row > 5 || !(cellCutoffV > rows[row].cutoffV)) break;
    }
  }
  if (row === 0) return rows[0][field];
  if (row > 5) return rows[5][field];
  const below = rows[row - 1];
  const above = rows[row];
  return (above[field] - below[field]) * (cellCutoffV - below.cutoffV) / (above.cutoffV - below.cutoffV) + below[field];
}

// Same, then interpolated between the four current tables.
function lookupAtCutoffAndCurrent(cell, cellCutoffV, currentA, field) {
  const v0 = lookupAtCutoff(cell, cellCutoffV, field, 0);
  const v1 = lookupAtCutoff(cell, cellCutoffV, field, 1);
  const v2 = lookupAtCutoff(cell, cellCutoffV, field, 2);
  const v3 = lookupAtCutoff(cell, cellCutoffV, field, 3);
  if (0.1 >= currentA) return v0;
  if (0.25 >= currentA) return (v1 - v0) * (currentA - 0.1) / 0.15 + v0;
  if (0.5 >= currentA) return (v2 - v1) * (currentA - 0.25) * 4 + v1;
  if (1 > currentA) return (v3 - v2) * (currentA - 0.5) * 2 + v2;
  return v3;
}

function cellCutoffV(pack, cutoffV) {
  return (cutoffV + (pack.dropV || 0)) / pack.cellsSeries;
}

/** Usable pack capacity (Ah) down to the motor's cut-off voltage when discharged at currentA. */
export function packCapacityAh(pack, cutoffV, currentA) {
  const perString = lookupAtCutoffAndCurrent(pack.cell, cellCutoffV(pack, cutoffV), currentA / pack.cellsParallel, 'capacityAh');
  return Math.max(0, perString * pack.cellsParallel);
}

/** Mean pack voltage (V) over a discharge to the cut-off voltage, read from the 0.25 A table. */
export function packMeanVoltage(pack, cutoffV) {
  return lookupAtCutoff(pack.cell, cellCutoffV(pack, cutoffV), 'meanV', 1) * pack.cellsSeries;
}

/** Mean pack voltage (V) at a given discharge current. The current is not divided by parallel strings (as in the tool). */
export function packMeanVoltageAt(pack, cutoffV, currentA) {
  return Math.max(0, lookupAtCutoffAndCurrent(pack.cell, cellCutoffV(pack, cutoffV), currentA, 'meanV') * pack.cellsSeries);
}

/** Days until the pack is empty, for a daily consumption in mWh and a peak discharge current in A. */
export function packLifetimeDays(pack, cutoffV, currentA, dailyUseMWh) {
  const capacityAtRestMAh = packCapacityAh(pack, cutoffV, 0) * 1000;
  const capacityMAh = packCapacityAh(pack, cutoffV, currentA) * 1000;
  const meanV = packMeanVoltage(pack, cutoffV);
  const selfDischargeMWh = meanV * ((pack.cell.selfDischargePctPerYear / 100) * capacityAtRestMAh) / 365;
  return meanV * capacityMAh / (selfDischargeMWh + dailyUseMWh);
}

// ---------------------------------------------------------------------------------------------
// Motor curves
// ---------------------------------------------------------------------------------------------

/** Current (A) from one of the motor's current curves. A speed-controlled motor draws more as the supply voltage falls. */
export function currentFromCurve(motor, curve, torqueNm, voltageV) {
  let { c2, c1, c0 } = curve;
  if (motor.speedControlled && voltageV > 0) {
    c2 = motor.characterisationV * c2 / voltageV;
    c1 = motor.characterisationV * c1 / voltageV;
    c0 = motor.characterisationV * c0 / voltageV;
  }
  return c2 * torqueNm * torqueNm + c1 * torqueNm + c0;
}

/** Speed (rpm) from one of the motor's speed curves. Without speed control the speed follows the supply voltage. */
export function speedFromCurve(motor, curve, torqueNm, voltageV) {
  if (motor.speedControlled) return curve.c0;
  return curve.c2 * torqueNm * torqueNm + curve.c1 * torqueNm + voltageV * curve.c0 / motor.characterisationV;
}

/** Motor current (A) at a signed torque: positive = load opposes the motor, zero or negative = load drives it. */
export function motorCurrentA(motor, torqueNm, voltageV) {
  return currentFromCurve(motor, torqueNm > TORQUE_EPSILON ? motor.currentResisting : motor.currentLeading, torqueNm, voltageV);
}

/** Motor speed (rpm) at a signed torque. */
export function motorSpeedRpm(motor, torqueNm, voltageV) {
  return speedFromCurve(motor, torqueNm > TORQUE_EPSILON ? motor.speedResisting : motor.speedLeading, torqueNm, voltageV);
}

// ---------------------------------------------------------------------------------------------
// Roller blind
// A blind is { widthM, dropM, tubeDiameterM, fabricThicknessM, fabricKgPerM2, bottomBarKgPerM, tubeWallM? }.
// ---------------------------------------------------------------------------------------------

/** Aluminium tube wall thickness (m) the method assumes for a given outside diameter (m). */
export function tubeWallThickness(tubeDiameterM) {
  if (0.03 >= tubeDiameterM) return 0.001;
  if (0.035 >= tubeDiameterM) return 0.0015;
  return 0.002;
}

function checkBlind(blind) {
  for (const key of ['widthM', 'dropM', 'tubeDiameterM', 'fabricThicknessM', 'fabricKgPerM2']) {
    if (!(blind[key] > 0)) throw new RangeError(`motor-calc: blind.${key} must be a positive number (got ${blind[key]})`);
  }
  if (!(blind.bottomBarKgPerM >= 0)) throw new RangeError(`motor-calc: blind.bottomBarKgPerM must be zero or more (got ${blind.bottomBarKgPerM})`);
}

function geometry(blind, motorMassKg) {
  checkBlind(blind);
  const radius = blind.tubeDiameterM * 0.5;
  const wall = blind.tubeWallM ?? tubeWallThickness(blind.tubeDiameterM);
  const thickness = blind.fabricThicknessM;
  const circumference = radius * TWO_PI;
  // turns of the tube needed to roll up the whole drop (fabric builds up on itself)
  const turns = (Math.sqrt(circumference * circumference + thickness * FOUR_PI * blind.dropM) - circumference) / (thickness * TWO_PI);
  const fabricKg = blind.dropM * blind.fabricKgPerM2 * blind.widthM;
  const bottomBarKg = blind.widthM * blind.bottomBarKgPerM;
  const tubeKg = (wall * blind.tubeDiameterM - wall * wall) * PI * ALUMINIUM_KG_PER_M3 * blind.widthM;
  // bearing friction: 25 % of everything the tube carries, acting at the tube's inner radius
  const frictionTorqueNm = (bottomBarKg + fabricKg + (motorMassKg + tubeKg)) * FRICTION_TIMES_GRAVITY * (radius - wall);
  return { radius, wall, thickness, turns, fabricKg, bottomBarKg, tubeKg, frictionTorqueNm };
}

// Torque from the hanging weight when `turnsOnTube` turns of fabric are rolled up.
function loadTorqueNm(blind, g, turnsOnTube) {
  const rolledLengthM = (2 * g.radius * turnsOnTube + g.thickness * (turnsOnTube * turnsOnTube)) * PI;
  const hangingKg = (blind.dropM - rolledLengthM) / blind.dropM * g.fabricKg + g.bottomBarKg;
  return hangingKg * GRAVITY * (g.thickness * turnsOnTube + g.radius);
}

function summary(g) {
  return {
    turns: g.turns,
    tubeWallM: g.wall,
    fabricKg: g.fabricKg,
    bottomBarKg: g.bottomBarKg,
    tubeKg: g.tubeKg,
    frictionTorqueNm: g.frictionTorqueNm,
    tooShortForModel: !(g.turns - STEP_TURNS >= UNSIMULATED_TURNS),
  };
}

/**
 * Peak torque (Nm) the motor must deliver over one up/down cycle. Needs no electrical data.
 * @returns {{ peakTorqueNm, frictionTorqueNm, turns, tubeWallM, fabricKg, bottomBarKg, tubeKg, tooShortForModel }}
 */
export function rollerTorque(blind, motorMassKg = 0) {
  const g = geometry(blind, motorMassKg);
  let peakTorqueNm = 0;
  for (let n = g.turns - STEP_TURNS; n >= UNSIMULATED_TURNS; n -= STEP_TURNS) {
    const load = loadTorqueNm(blind, g, n);
    peakTorqueNm = Math.max(peakTorqueNm, load + g.frictionTorqueNm, g.frictionTorqueNm - load);
  }
  return { ...summary(g), peakTorqueNm };
}

/**
 * One full cycle (up and down) of a roller blind on a given motor and battery pack.
 * @returns everything rollerTorque returns, plus
 *   { peakCurrentA, energyUpMWh, energyDownMWh, energyPerCycleMWh, secondsUp, secondsDown }
 */
export function rollerCycle(blind, motor, pack) {
  const g = geometry(blind, motor.massKg || 0);
  const dropV = pack.dropV || 0;
  let peakTorqueNm = 0;
  let peakCurrentA = 0;
  let joulesUp = 0;
  let joulesDown = 0;
  let secondsUp = 0;
  let secondsDown = 0;
  let previous = g.turns;

  // one 0.1-turn step in one direction: current drawn, time taken, energy taken from the battery
  const step = (torqueNm, turnsMoved) => {
    const restingV = packMeanVoltage(pack, motor.cutoffV);
    const currentA = motorCurrentA(motor, torqueNm, restingV);
    const motorV = packMeanVoltageAt(pack, motor.cutoffV, currentA) - dropV;
    const turnsPerSecond = motorSpeedRpm(motor, torqueNm, motorV) / 60;
    const seconds = turnsPerSecond > 0 ? turnsMoved / turnsPerSecond : 0;
    const joules = packMeanVoltageAt(pack, motor.cutoffV, currentA) * currentA * seconds;
    return { currentA, seconds, joules };
  };

  for (let n = g.turns - STEP_TURNS; n >= UNSIMULATED_TURNS; n -= STEP_TURNS) {
    const load = loadTorqueNm(blind, g, n);
    const moved = previous - n;

    const up = step(load + g.frictionTorqueNm, moved);
    const down = step(g.frictionTorqueNm - load, moved);

    peakTorqueNm = Math.max(peakTorqueNm, load + g.frictionTorqueNm, g.frictionTorqueNm - load);
    peakCurrentA = Math.max(peakCurrentA, up.currentA, down.currentA);
    joulesUp += up.joules;
    joulesDown += down.joules;
    secondsUp += up.seconds;
    secondsDown += down.seconds;
    previous = n;
  }

  return {
    ...summary(g),
    peakTorqueNm,
    peakCurrentA,
    energyUpMWh: joulesUp * 1000 / 3600,
    energyDownMWh: joulesDown * 1000 / 3600,
    energyPerCycleMWh: (joulesDown + joulesUp) * 1000 / 3600,
    secondsUp,
    secondsDown,
  };
}

/**
 * Battery autonomy for a motor, pack and simulated cycle.
 * @param usage { cyclesPerDay, rfTrafficPct }  rfTrafficPct: see RF_TRAFFIC_PCT (default medium)
 * @returns {{ days, years, batteryEnergyMWh, capacityAh, meanVoltageV, movementMWh, standbyMWh, radioMWh,
 *             dailyUseMWh, selfDischargeMWh, cyclesPerCharge }}
 */
export function autonomy(motor, pack, cycle, usage = {}) {
  const cyclesPerDay = usage.cyclesPerDay ?? 1;
  const rfTrafficPct = usage.rfTrafficPct ?? RF_TRAFFIC_PCT.medium;
  if (!(cyclesPerDay >= 0)) throw new RangeError(`motor-calc: cyclesPerDay must be zero or more (got ${cyclesPerDay})`);

  const meanVoltageV = packMeanVoltage(pack, motor.cutoffV);
  const voltHoursPerDay = meanVoltageV * 24;
  const standbyMWh = motor.standbyUa * voltHoursPerDay / 1000;
  const radioMWh = motor.radioSensitive ? rfTrafficPct / 100 * (motor.awakeMa * voltHoursPerDay) : 0;
  const movementMWh = cyclesPerDay * cycle.energyPerCycleMWh;
  const dailyUseMWh = movementMWh + (radioMWh + standbyMWh);

  // capacity is read at the peak current of the cycle (at rest if the blind never moves)
  const dischargeA = cyclesPerDay === 0 ? 0 : cycle.peakCurrentA;
  const capacityAh = packCapacityAh(pack, motor.cutoffV, dischargeA);
  const batteryEnergyMWh = meanVoltageV * (capacityAh * 1000);
  const selfDischargeMWh = meanVoltageV * ((pack.cell.selfDischargePctPerYear / 100) * (packCapacityAh(pack, motor.cutoffV, 0) * 1000)) / 365;
  const days = packLifetimeDays(pack, motor.cutoffV, dischargeA, dailyUseMWh);

  return {
    days,
    years: days / 365,
    batteryEnergyMWh,
    capacityAh,
    meanVoltageV,
    movementMWh,
    standbyMWh,
    radioMWh,
    dailyUseMWh,
    selfDischargeMWh,
    // movements available from one charge if there were no standby, radio or self-discharge losses
    cyclesPerCharge: cycle.energyPerCycleMWh > 0 ? batteryEnergyMWh / cycle.energyPerCycleMWh : Infinity,
  };
}
