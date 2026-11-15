import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_LOOKUP_NAMES,
    formatStationNameLookup,
    hasOwn,
    lookupStationNames,
    sanitizeStationName,
} from '../build/station-names.js';

const STATIONS = {
    北京南: { station_code: 'VNP', station_name: '北京南' },
    上海虹桥: { station_code: 'AOH', station_name: '上海虹桥' },
};

test('sanitizeStationName keeps plain Chinese station names', () => {
    assert.equal(sanitizeStationName('北京南'), '北京南');
    assert.equal(sanitizeStationName('  上海虹桥  '), '上海虹桥');
});

test('sanitizeStationName drops the habitual "站" suffix', () => {
    assert.equal(sanitizeStationName('北京南站'), '北京南');
});

test('sanitizeStationName rejects text that is not a station name', () => {
    for (const input of [
        '<img src=x onerror=alert(1)>',
        '{{7*7}}',
        'Beijing',
        '北京南<script>',
        '北京南\u0000',
        'A'.repeat(32),
        '京'.repeat(21),
        '',
        '   ',
    ]) {
        assert.equal(sanitizeStationName(input), null, JSON.stringify(input));
    }
});

test('hasOwn ignores inherited object properties', () => {
    assert.equal(hasOwn(STATIONS, '北京南'), true);
    assert.equal(hasOwn(STATIONS, '广州南'), false);
    assert.equal(hasOwn(STATIONS, 'constructor'), false);
    assert.equal(hasOwn(STATIONS, 'toString'), false);
});

test('lookupStationNames resolves known stations', () => {
    const result = lookupStationNames('北京南|上海虹桥站', STATIONS);
    assert.deepEqual(result.found, {
        北京南: { station_code: 'VNP', station_name: '北京南' },
        上海虹桥: { station_code: 'AOH', station_name: '上海虹桥' },
    });
    assert.deepEqual(result.notFound, []);
    assert.equal(result.ignoredCount, 0);
});

test('lookupStationNames reports unknown station names without echoing raw text', () => {
    const result = lookupStationNames('北京西|{{7*7}}|<img src=x>', STATIONS);
    assert.deepEqual(result.found, {});
    assert.deepEqual(result.notFound, ['北京西']);
    assert.equal(result.ignoredCount, 2);
    const text = formatStationNameLookup(result);
    assert.equal(text.includes('<img'), false);
    assert.equal(text.includes('{{'), false);
    assert.equal(JSON.parse(text).notFound[0], '北京西');
});

test('lookupStationNames does not match prototype properties', () => {
    const result = lookupStationNames('constructor|toString|__proto__', STATIONS);
    assert.deepEqual(result.found, {});
    assert.deepEqual(result.notFound, []);
    // All three are ASCII, so they are dropped as implausible station names.
    assert.equal(result.ignoredCount, 3);
});

test('lookupStationNames caps the number of processed names', () => {
    // The 21st name is beyond MAX_LOOKUP_NAMES and must not be resolved.
    const input = [...Array(MAX_LOOKUP_NAMES).fill('北京南'), '上海虹桥'].join('|');
    const result = lookupStationNames(input, STATIONS);
    assert.deepEqual(Object.keys(result.found), ['北京南']);
    assert.deepEqual(result.notFound, []);
});

test('formatStationNameLookup keeps the legacy shape for known stations', () => {
    const text = formatStationNameLookup(
        lookupStationNames('北京南', STATIONS)
    );
    assert.deepEqual(JSON.parse(text), {
        北京南: { station_code: 'VNP', station_name: '北京南' },
    });
});

test('formatStationNameLookup omits empty optional fields', () => {
    assert.equal(
        formatStationNameLookup(lookupStationNames('北京南', STATIONS)),
        '{"北京南":{"station_code":"VNP","station_name":"北京南"}}'
    );
});
