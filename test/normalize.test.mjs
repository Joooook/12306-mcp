import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    addMinutes,
    deriveTicketTiming,
    filterByStationCodes,
    formatDuration,
    minutesBetween,
    parseChineseDurationMinutes,
    parseLishiMinutes,
    resolveStationSelection,
    verifyInterlineCandidate,
} from '../build/normalize.js';

const fixture = (name) =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const direct = fixture('direct-vnp-tjp-20261120.json');
const interline = fixture('interline-bxp-icw-20261120.json');

// 每条余票原始记录拆成测试关心的字段。
function directRows() {
    return direct.data.result.map((row) => {
        const v = row.split('|');
        return {
            train: v[3],
            from_station_telecode: v[6],
            to_station_telecode: v[7],
            start_time: v[8],
            arrive_time: v[9],
            lishi: v[10],
            start_train_date: v[13],
        };
    });
}

const CATALOG = {
    byCode: {
        BJP: { station_code: 'BJP', station_name: '北京', city: '北京' },
        VNP: { station_code: 'VNP', station_name: '北京南', city: '北京' },
        BXP: { station_code: 'BXP', station_name: '北京西', city: '北京' },
        FTP: { station_code: 'FTP', station_name: '北京丰台', city: '北京' },
        AOH: { station_code: 'AOH', station_name: '上海虹桥', city: '上海' },
    },
    byName: {
        北京: { station_code: 'BJP', station_name: '北京' },
        北京南: { station_code: 'VNP', station_name: '北京南' },
        北京西: { station_code: 'BXP', station_name: '北京西' },
        北京丰台: { station_code: 'FTP', station_name: '北京丰台' },
        上海虹桥: { station_code: 'AOH', station_name: '上海虹桥' },
    },
    byCity: {
        北京: [
            { station_code: 'BJP', station_name: '北京' },
            { station_code: 'VNP', station_name: '北京南' },
            { station_code: 'BXP', station_name: '北京西' },
            { station_code: 'FTP', station_name: '北京丰台' },
        ],
        上海: [{ station_code: 'AOH', station_name: '上海虹桥' }],
    },
    cityCodes: {
        北京: { station_code: 'BJP', station_name: '北京' },
        上海: { station_code: 'AOH', station_name: '上海虹桥' },
    },
};

test('addMinutes crosses midnight, month and year boundaries', () => {
    assert.deepEqual(addMinutes('2026-11-20', '23:50', 20), {
        date: '2026-11-21',
        time: '00:10',
    });
    assert.deepEqual(addMinutes('2026-12-31', '23:50', 20), {
        date: '2027-01-01',
        time: '00:10',
    });
    assert.deepEqual(addMinutes('2026-11-30', '23:30', 60), {
        date: '2026-12-01',
        time: '00:30',
    });
});

test('addMinutes handles leap day', () => {
    assert.deepEqual(addMinutes('2028-02-28', '23:59', 2), {
        date: '2028-02-29',
        time: '00:01',
    });
    assert.deepEqual(addMinutes('2028-02-29', '12:00', 60 * 24), {
        date: '2028-03-01',
        time: '12:00',
    });
});

test('addMinutes rejects malformed input', () => {
    assert.equal(addMinutes('2026-11-20', '24:00', 0), null);
    assert.equal(addMinutes('2026-13-01', '10:00', 0), null);
    assert.equal(addMinutes('20-11-20', '10:00', 0), null);
});

test('formatDuration pads the minute part', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(5), '00:05');
    assert.equal(formatDuration(65), '01:05');
    assert.equal(formatDuration(305), '05:05');
    assert.equal(formatDuration(327), '05:27');
    assert.equal(formatDuration(1306), '21:46');
});

test('duration parsers', () => {
    assert.equal(parseLishiMinutes('01:43'), 103);
    assert.equal(parseLishiMinutes('00:05'), 5);
    assert.equal(parseLishiMinutes('bad'), null);
    assert.equal(parseChineseDurationMinutes('21小时46分钟'), 1306);
    assert.equal(parseChineseDurationMinutes('40分钟'), 40);
    assert.equal(parseChineseDurationMinutes('2小时'), 120);
    assert.equal(parseChineseDurationMinutes(''), null);
    assert.equal(parseChineseDurationMinutes('abc'), null);
});

test('minutesBetween spans midnight', () => {
    assert.equal(
        minutesBetween(
            { date: '2026-11-20', time: '19:50' },
            { date: '2026-11-21', time: '01:17' }
        ),
        327
    );
});

test('resolveStationSelection: telecode means that exact station', () => {
    const selection = resolveStationSelection('VNP', CATALOG);
    assert.equal(selection.scope, 'exact');
    assert.equal(selection.queryCode, 'VNP');
    assert.deepEqual(selection.allowedCodes, ['VNP']);
});

test('resolveStationSelection: station name means that exact station', () => {
    for (const input of ['北京南', '北京南站']) {
        const selection = resolveStationSelection(input, CATALOG);
        assert.equal(selection.scope, 'exact', input);
        assert.equal(selection.queryCode, 'VNP', input);
        assert.deepEqual(selection.allowedCodes, ['VNP'], input);
    }
});

test('resolveStationSelection: bare city name keeps city-wide scope', () => {
    const selection = resolveStationSelection('北京', CATALOG);
    assert.equal(selection.scope, 'city');
    assert.equal(selection.city, '北京');
    assert.equal(selection.queryCode, 'BJP');
    assert.deepEqual([...selection.allowedCodes].sort(), [
        'BJP',
        'BXP',
        'FTP',
        'VNP',
    ]);
});

test('resolveStationSelection: trailing 站 on a city name picks the station', () => {
    const selection = resolveStationSelection('北京站', CATALOG);
    assert.equal(selection.scope, 'exact');
    assert.equal(selection.queryCode, 'BJP');
});

test('resolveStationSelection rejects unknown and prototype names', () => {
    for (const input of ['火星', 'constructor', 'toString', '__proto__', '']) {
        assert.equal(resolveStationSelection(input, CATALOG), null, input);
    }
});

test('resolveStationSelection: exact preference keeps only the station', () => {
    const byCityName = resolveStationSelection('北京', CATALOG, 'exact');
    assert.equal(byCityName.scope, 'exact');
    assert.equal(byCityName.queryCode, 'BJP');
    assert.deepEqual(byCityName.allowedCodes, ['BJP']);

    const byStationName = resolveStationSelection('北京南', CATALOG, 'exact');
    assert.equal(byStationName.queryCode, 'VNP');
    assert.equal(resolveStationSelection('火星', CATALOG, 'exact'), null);
});

test('resolveStationSelection: city preference expands a station code to its city', () => {
    // get-station-code-of-citys 返回的代表站编码可以在 stationScope=city 下当城市用。
    const fromCode = resolveStationSelection('BJP', CATALOG, 'city');
    assert.equal(fromCode.scope, 'city');
    assert.equal(fromCode.city, '北京');
    assert.deepEqual([...fromCode.allowedCodes].sort(), [
        'BJP',
        'BXP',
        'FTP',
        'VNP',
    ]);

    const fromStation = resolveStationSelection('北京南', CATALOG, 'city');
    assert.equal(fromStation.scope, 'city');
    assert.equal(fromStation.city, '北京');

    assert.equal(resolveStationSelection('火星', CATALOG, 'city'), null);
});

test('deriveTicketTiming uses the boarding date, not start_train_date', () => {
    // K7731 leaves its origin on 11-19 and passes 北京丰台 at 00:22 on 11-20.
    const ticket = directRows().find((row) => row.train === 'K7731');
    assert.equal(ticket.start_train_date, '20261119');
    const timing = deriveTicketTiming(
        direct.queryDate,
        ticket.start_time,
        ticket.lishi
    );
    assert.deepEqual(timing, {
        start_date: '2026-11-20',
        arrive_date: '2026-11-20',
    });
});

test('every direct result boards on the query date', () => {
    for (const row of directRows()) {
        const timing = deriveTicketTiming(
            direct.queryDate,
            row.start_time,
            row.lishi
        );
        assert.equal(timing.start_date, direct.queryDate, row.train);
    }
});

test('direct overnight rows arrive on the following day', () => {
    const timing = deriveTicketTiming('2026-11-20', '21:25', '08:22');
    assert.deepEqual(timing, {
        start_date: '2026-11-20',
        arrive_date: '2026-11-21',
    });
});

test('station filtering drops same-city and wrong-destination rows', () => {
    const rows = directRows().map((row) => ({ ...row }));
    const filtered = filterByStationCodes(rows, ['VNP'], ['TJP']);
    assert.deepEqual(filtered.map((row) => row.train).sort(), [
        'C2001',
        'C2551',
    ]);
});

test('city scope keeps all stations of the city', () => {
    const rows = directRows().map((row) => ({ ...row }));
    const filtered = filterByStationCodes(
        rows,
        CATALOG.byCity['北京'].map((station) => station.station_code),
        ['TJP']
    );
    // VNP 与 FTP 的车次都保留，其他城市的出发站被过滤掉。
    assert.deepEqual(filtered.map((row) => row.from_station_telecode).sort(), [
        'FTP',
        'FTP',
        'FTP',
        'VNP',
        'VNP',
    ]);
});

// 12306 按城市返回中转方案：郑州东(ZAF)、郑州(ZZF)、郑州西(XPF) 同属郑州。
const INTERLINE_SCOPE = {
    // 上游按城市返回出发站，D117/K401 实际从北京丰台(FTP)发车。
    fromCodes: ['BXP', 'FTP', 'VNP', 'BJP'],
    toCodes: ['ICW'],
    middleCodes: ['ZAF', 'ZZF', 'XPF'],
};

function candidate(code) {
    const item = interline.middleList.find(
        (entry) => entry.fullList[0].station_train_code === code
    );
    assert.ok(item, `fixture is missing ${code}`);
    return structuredClone(item);
}

test('interline: same-day plan keeps derived dates', () => {
    const check = verifyInterlineCandidate(
        candidate('G321'),
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, true);
    assert.equal(check.timing.first.start_date, '2026-11-20');
    assert.equal(check.timing.arrive_date, '2026-11-20');
    assert.equal(check.timing.totalMinutes, 450);
    assert.equal(formatDuration(check.timing.totalMinutes), '07:30');
});

test('interline: same train crossing midnight', () => {
    const check = verifyInterlineCandidate(
        candidate('D117'),
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, true);
    assert.deepEqual(check.timing.first, {
        start_date: '2026-11-20',
        start_time: '12:50',
        arrive_date: '2026-11-20',
        arrive_time: '18:59',
        lishi: '06:09',
    });
    assert.equal(check.timing.middle_date, '2026-11-20');
    assert.deepEqual(check.timing.second, {
        start_date: '2026-11-20',
        start_time: '19:19',
        arrive_date: '2026-11-21',
        arrive_time: '10:36',
        lishi: '15:17',
    });
    assert.equal(check.timing.totalMinutes, 1306);
    assert.equal(formatDuration(check.timing.totalMinutes), '21:46');
});

test('interline: transfer on the next day uses the next day for both legs', () => {
    const check = verifyInterlineCandidate(
        candidate('K401'),
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, true);
    assert.deepEqual(check.timing.first, {
        start_date: '2026-11-20',
        start_time: '21:25',
        arrive_date: '2026-11-21',
        arrive_time: '05:47',
        lishi: '08:22',
    });
    assert.equal(check.timing.middle_date, '2026-11-21');
    assert.deepEqual(check.timing.second, {
        start_date: '2026-11-21',
        start_time: '09:29',
        arrive_date: '2026-11-21',
        arrive_time: '15:36',
        lishi: '06:07',
    });
    assert.equal(check.timing.waitMinutes, 222);
    assert.equal(formatDuration(check.timing.totalMinutes), '18:11');
});

test('interline: plan arriving at a same-city station is rejected', () => {
    // G337 -> Z315 实际到达成都西(CMW)，请求的是成都东(ICW)。
    const check = verifyInterlineCandidate(
        candidate('G337'),
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, false);
    assert.match(check.reason, /第二段到达站 CMW/);
});

test('interline: long overnight plan keeps both dates when the city is in scope', () => {
    const check = verifyInterlineCandidate(
        candidate('G337'),
        interline.queryDate,
        { ...INTERLINE_SCOPE, toCodes: ['ICW', 'CMW'] }
    );
    assert.equal(check.ok, true);
    assert.equal(check.timing.first.start_date, '2026-11-20');
    assert.equal(check.timing.middle_date, '2026-11-20');
    assert.equal(check.timing.arrive_date, '2026-11-21');
    assert.equal(formatDuration(check.timing.totalMinutes), '27:39');
});

test('interline: reporter case G65 -> G4791 with 00:10 boarding on the next day', () => {
    const plan = {
        train_date: '2026-10-06',
        middle_date: '2026-10-07',
        arrive_date: '2026-10-07',
        wait_time_minutes: 40,
        all_lishi_minutes: 327,
        fullList: [
            {
                from_station_telecode: 'VNP',
                to_station_telecode: 'NKH',
                start_time: '19:50',
                arrive_time: '23:30',
                lishi: '03:40',
                start_train_date: '20261006',
            },
            {
                from_station_telecode: 'NKH',
                to_station_telecode: 'AOH',
                start_time: '00:10',
                arrive_time: '01:17',
                lishi: '01:07',
                // 列车 10-06 21:01 从郑州东始发，10-07 00:10 才到南京南。
                start_train_date: '20261006',
            },
        ],
    };
    const check = verifyInterlineCandidate(plan, '2026-10-06', {
        fromCodes: ['VNP'],
        toCodes: ['AOH'],
        middleCodes: ['NKH'],
    });
    assert.equal(check.ok, true);
    assert.equal(check.timing.first.start_date, '2026-10-06');
    assert.equal(check.timing.middle_date, '2026-10-07');
    assert.equal(check.timing.second.start_date, '2026-10-07');
    assert.equal(check.timing.second.arrive_date, '2026-10-07');
    assert.equal(check.timing.waitMinutes, 40);
    assert.equal(formatDuration(check.timing.totalMinutes), '05:27');
});

test('interline: wrong wait time is rejected', () => {
    const plan = candidate('D117');
    plan.wait_time_minutes = 10;
    const check = verifyInterlineCandidate(
        plan,
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, false);
    assert.match(check.reason, /第二段发车时刻不一致/);
});

test('interline: contradictory summary dates are rejected', () => {
    const plan = candidate('D117');
    plan.middle_date = '2026-11-21';
    const check = verifyInterlineCandidate(
        plan,
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, false);
    assert.match(check.reason, /换乘日期不一致/);
});

test('interline: contradictory total duration is rejected', () => {
    const plan = candidate('D117');
    plan.all_lishi_minutes = 1305;
    const check = verifyInterlineCandidate(
        plan,
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, false);
    assert.match(check.reason, /总历时不一致/);
});

test('interline: wrong endpoints are rejected', () => {
    const wrongFrom = verifyInterlineCandidate(
        candidate('D117'),
        interline.queryDate,
        { ...INTERLINE_SCOPE, fromCodes: ['VNP'] }
    );
    assert.equal(wrongFrom.ok, false);
    assert.match(wrongFrom.reason, /第一段出发站/);

    const wrongMiddle = verifyInterlineCandidate(
        candidate('K401'),
        interline.queryDate,
        { ...INTERLINE_SCOPE, middleCodes: ['NKH'] }
    );
    assert.equal(wrongMiddle.ok, false);
    assert.match(wrongMiddle.reason, /中转范围/);

    const wrongTo = verifyInterlineCandidate(
        candidate('K401'),
        interline.queryDate,
        { ...INTERLINE_SCOPE, toCodes: ['AOH'] }
    );
    assert.equal(wrongTo.ok, false);
    assert.match(wrongTo.reason, /第二段到达站/);
});

test('interline: boarding before the train origin date is rejected', () => {
    const plan = candidate('K401');
    plan.fullList[1].start_train_date = '20261122';
    const check = verifyInterlineCandidate(
        plan,
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, false);
    assert.match(check.reason, /乘车日期/);
});

test('interline: only two-leg plans are supported', () => {
    const plan = candidate('K401');
    plan.fullList = plan.fullList.slice(0, 1);
    const check = verifyInterlineCandidate(
        plan,
        interline.queryDate,
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, false);
    assert.match(check.reason, /两段/);
});

test('interline: query date mismatch is rejected', () => {
    const check = verifyInterlineCandidate(
        candidate('K401'),
        '2026-11-21',
        INTERLINE_SCOPE
    );
    assert.equal(check.ok, false);
    assert.match(check.reason, /train_date/);
});
