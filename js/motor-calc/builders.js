// motor-calc/builders.js
//
// Helpers that turn stored or published figures into the objects engine.js works with:
//   catalogFrom        links motors, packs and cells loaded from a data file or a database
//   motorFromDatasheet builds a motor from ordinary datasheet figures (for motors without a record of their own)
//   packFromSpec       builds a battery pack from its capacity and voltage
//
// Plain ES module: no imports, no DOM, no network.

function positive(value, name) {
  if (!(value > 0)) throw new RangeError(`motor-calc: ${name} must be a positive number (got ${value})`);
  return value;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Link plain records into a catalogue. Packs get their cell attached, which engine.js needs.
 * Records have the shapes of the pack's data file; packs built with packFromSpec can be passed in as they are.
 */
export function catalogFrom({ motors = [], packs = [], cells = [] } = {}) {
  const cellById = new Map(cells.map((cell) => [cell.id, cell]));
  const packById = new Map();
  for (const pack of packs) {
    const cell = pack.cell ?? cellById.get(pack.cellId);
    if (!cell) throw new Error(`motor-calc: pack "${pack.id}" refers to unknown cell "${pack.cellId}"`);
    packById.set(pack.id, { ...pack, cell });
  }
  const motorById = new Map(motors.map((motor) => [motor.id, motor]));
  const need = (map, id, kind) => {
    const found = map.get(id);
    if (!found) throw new Error(`motor-calc: no ${kind} with id "${id}"`);
    return found;
  };
  return {
    motors: [...motorById.values()],
    packs: [...packById.values()],
    motor: (id) => need(motorById, id, 'motor'),
    pack: (id) => need(packById, id, 'battery pack'),
    /** The battery packs a motor can use, in the order listed on the motor (first = default). */
    packsFor: (motor) => (motor.packIds ?? []).map((id) => need(packById, id, 'battery pack')),
  };
}

/**
 * Build a motor from datasheet figures.
 *
 * Required: name, ratedTorqueNm, ratedSpeedRpm, nominalVoltageV, and ratedCurrentA or ratedPowerW.
 * Optional, with the value assumed when left out:
 *   noLoadCurrentA    15 % of rated current
 *   standbyCurrentUa  100 uA   (receiver asleep)
 *   awakeCurrentMa    9 mA     (receiver awake, motor stopped)
 *   massKg            0.5 kg   (motor, plus its battery if the battery sits inside the tube)
 *   cutoffV           90 % of nominal voltage
 *   maxTorqueNm       rated torque
 *   speedControlled   true     (speed held at the rated figure whatever the load)
 *   radioSensitive    true     (woken by nearby radio traffic)
 *
 * Current is a straight line from the no-load current at zero torque to the rated current at rated torque.
 * Lowering is taken at the no-load current. Everything assumed is listed in the returned motor's `assumptions`.
 */
export function motorFromDatasheet(spec) {
  const name = spec.name ?? 'Unnamed motor';
  const ratedTorqueNm = positive(spec.ratedTorqueNm, 'ratedTorqueNm');
  const ratedSpeedRpm = positive(spec.ratedSpeedRpm, 'ratedSpeedRpm');
  const nominalVoltageV = positive(spec.nominalVoltageV, 'nominalVoltageV');
  if (spec.ratedCurrentA == null && spec.ratedPowerW == null) {
    throw new RangeError('motor-calc: give ratedCurrentA or ratedPowerW');
  }
  const ratedCurrentA = positive(spec.ratedCurrentA ?? spec.ratedPowerW / nominalVoltageV, spec.ratedCurrentA != null ? 'ratedCurrentA' : 'ratedPowerW');

  const assumptions = [];
  const orAssume = (value, fallback, text) => {
    if (value != null) return value;
    assumptions.push(text);
    return fallback;
  };
  if (spec.ratedCurrentA == null) assumptions.push(`rated current taken as rated power / nominal voltage (${ratedCurrentA.toFixed(3)} A)`);
  const noLoadCurrentA = orAssume(spec.noLoadCurrentA, 0.15 * ratedCurrentA, 'no-load current assumed to be 15 % of rated current');
  if (!(noLoadCurrentA >= 0 && noLoadCurrentA < ratedCurrentA)) {
    throw new RangeError('motor-calc: noLoadCurrentA must be zero or more and below the rated current');
  }

  return {
    id: spec.id ?? slug(name),
    name,
    source: spec.source ?? 'datasheet',
    maxTorqueNm: spec.maxTorqueNm ?? ratedTorqueNm,
    cutoffV: orAssume(spec.cutoffV, 0.9 * nominalVoltageV, 'cut-off voltage assumed to be 90 % of nominal voltage'),
    standbyUa: orAssume(spec.standbyCurrentUa, 100, 'standby current assumed to be 100 uA'),
    awakeMa: orAssume(spec.awakeCurrentMa, 9, 'receiver-awake current assumed to be 9 mA'),
    currentResisting: { c2: 0, c1: (ratedCurrentA - noLoadCurrentA) / ratedTorqueNm, c0: noLoadCurrentA },
    currentLeading: { c2: 0, c1: 0, c0: noLoadCurrentA },
    speedResisting: { c2: 0, c1: 0, c0: ratedSpeedRpm },
    speedLeading: { c2: 0, c1: 0, c0: ratedSpeedRpm },
    characterisationV: nominalVoltageV,
    speedControlled: spec.speedControlled ?? true,
    massKg: orAssume(spec.massKg, 0.5, 'motor weight assumed to be 0.5 kg'),
    radioSensitive: spec.radioSensitive ?? true,
    defaultTubeMm: spec.defaultTubeMm ?? null,
    packIds: spec.packIds ?? [],
    assumptions,
  };
}

/**
 * Build a battery pack from pack-level figures. Capacity is treated as the same at every discharge current,
 * which is how the method treats Li-ion packs.
 *
 * Required: capacityAh (usable capacity of the whole pack), meanVoltageV (average voltage over a discharge,
 *           e.g. 3.6 V per Li-ion cell in series).
 * Optional: selfDischargePctPerYear (20, the figure the method uses for Li-ion), dropV (0; volts lost
 *           between pack and motor, e.g. through a diode), id, name, technology.
 */
export function packFromSpec(spec) {
  const capacityAh = positive(spec.capacityAh, 'capacityAh');
  const meanVoltageV = positive(spec.meanVoltageV, 'meanVoltageV');
  const name = spec.name ?? 'Unnamed battery pack';
  const id = spec.id ?? slug(name);
  const assumptions = [];
  let selfDischargePctPerYear = spec.selfDischargePctPerYear;
  if (selfDischargePctPerYear == null) {
    selfDischargePctPerYear = 20;
    assumptions.push('self-discharge assumed to be 20 % per year');
  }
  // engine.js reads four tables (0.1, 0.25, 0.5, 1 A) of six cut-off rows; here they are all the same
  const rows = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3].map((cutoffV) => ({ cutoffV, capacityAh, meanV: meanVoltageV }));
  const tables = [0.1, 0.25, 0.5, 1].map((currentA) => ({ currentA, rows }));
  return {
    id,
    name,
    cellsSeries: 1,
    cellsParallel: 1,
    dropV: spec.dropV ?? 0,
    cell: { id: `${id}-cell`, name, technology: spec.technology ?? 'Li-ion', nominalV: meanVoltageV, selfDischargePctPerYear, tables },
    assumptions,
  };
}
