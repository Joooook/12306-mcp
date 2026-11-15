// 站点范围与车票日期/历时的规范化。
//
// 12306 的原始数据有两个容易踩的坑（issue #72）：
//
// 1. 余票接口会按“同城”扩展搜索结果：即使传入具体站点的电报码，也会返回
//    同城其他站的车次；中转接口同样可能返回相邻城市的到发站。
// 2. start_train_date 是列车从始发站开出的日期，不是乘客的乘车日期。列车
//    在凌晨经过中间站时，乘车日期已经是第二天，中转第二段尤其明显。
//
// 这里把这两件事都做成纯函数，便于用真实响应的切片做回归测试。

export interface LocalDateTime {
    /** yyyy-MM-dd */
    date: string;
    /** HH:mm */
    time: string;
}

export interface StationRef {
    station_code: string;
    station_name: string;
    /** 所属城市，缺省时无法做城市级扩展 */
    city?: string;
}

export type StationScope = 'exact' | 'city';

/** 调用方对查询范围的偏好：auto 按输入形态推断，exact/city 强制指定。 */
export type StationScopePreference = 'auto' | 'exact' | 'city';

export interface StationSelection {
    scope: StationScope;
    /** 发给 12306 的电报码 */
    queryCode: string;
    /** 结果中允许出现的电报码 */
    allowedCodes: string[];
    /** 同一城市内的全部车站，用于中转站校验（12306 本身按城市返回换站换乘方案） */
    cityWideCodes: string[];
    /** 命中城市范围时的城市名 */
    city?: string;
}

export interface StationCatalog {
    /** 电报码 -> 车站 */
    byCode: Record<string, StationRef>;
    /** 车站名 -> 车站 */
    byName: Record<string, StationRef>;
    /** 城市名 -> 该城市的车站 */
    byCity: Record<string, StationRef[]>;
    /** 城市名 -> 代表该城市的车站 */
    cityCodes: Record<string, StationRef>;
}

export interface TicketTiming {
    start_date: string;
    arrive_date: string;
}

export interface InterlineLegLike {
    from_station_telecode: string;
    to_station_telecode: string;
    start_time: string;
    arrive_time: string;
    lishi: string;
    start_train_date: string;
}

export interface InterlineCandidateLike {
    train_date: string;
    middle_date: string;
    arrive_date: string;
    wait_time_minutes?: number;
    wait_time?: string;
    all_lishi_minutes?: number;
    fullList: InterlineLegLike[];
}

export interface InterlineScope {
    fromCodes: string[];
    toCodes: string[];
    /** 未指定中转城市时为 null */
    middleCodes: string[] | null;
}

export interface LegTiming {
    start_date: string;
    start_time: string;
    arrive_date: string;
    arrive_time: string;
    lishi: string;
}

export interface InterlineTiming {
    first: LegTiming;
    second: LegTiming;
    middle_date: string;
    arrive_date: string;
    /** 从第一段发车到第二段到达的总分钟数 */
    totalMinutes: number;
    waitMinutes: number;
}

export type InterlineCheck =
    | { ok: true; timing: InterlineTiming }
    | { ok: false; reason: string };

const TELE_CODE_PATTERN = /^[A-Z]+$/;
const DURATION_PATTERN = /^(\d{1,3}):(\d{2})$/;
const CHINESE_DURATION_PATTERN = /^(?:(\d+)小时)?(?:(\d+)分钟)?$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 城市名后常见的“站”后缀，用于判断用户是否明确指定了某个车站。 */
function trimStationSuffix(name: string): string {
    return name.endsWith('站') ? name.slice(0, -1) : name;
}

function hasOwn<T>(record: Record<string, T>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * 解析 12306 的 hh:mm 历时（如 "01:43"）为分钟数。
 */
export function parseLishiMinutes(lishi: string): number | null {
    const match = DURATION_PATTERN.exec(lishi.trim());
    if (match === null) {
        return null;
    }
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/**
 * 解析中文历时（如 "21小时46分钟"、"40分钟"、"2小时"）为分钟数。
 */
export function parseChineseDurationMinutes(duration: string): number | null {
    const trimmed = duration.trim();
    if (trimmed === '') {
        return null;
    }
    const match = CHINESE_DURATION_PATTERN.exec(trimmed);
    if (match === null || (match[1] === undefined && match[2] === undefined)) {
        return null;
    }
    const hours = match[1] === undefined ? 0 : parseInt(match[1], 10);
    const minutes = match[2] === undefined ? 0 : parseInt(match[2], 10);
    return hours * 60 + minutes;
}

/**
 * 把分钟数格式化为 hh:mm，分钟补足两位（修复 "05:5" 这类输出）。
 */
export function formatDuration(minutes: number): string {
    const safeMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const rest = safeMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * 在“上海时区墙钟时间”上做加法。全程用 UTC 计算，结果不受运行机器时区影响。
 */
export function addMinutes(
    date: string,
    time: string,
    minutes: number
): LocalDateTime | null {
    const dateMatch = DATE_PATTERN.exec(date.trim());
    const timeMatch = TIME_PATTERN.exec(time.trim());
    if (dateMatch === null || timeMatch === null) {
        return null;
    }
    const year = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const day = parseInt(dateMatch[3], 10);
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    if (
        hour > 23 ||
        minute > 59 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }
    const start = Date.UTC(year, month - 1, day, hour, minute);
    const result = new Date(start + Math.round(minutes) * 60_000);
    const resultDate = [
        result.getUTCFullYear(),
        String(result.getUTCMonth() + 1).padStart(2, '0'),
        String(result.getUTCDate()).padStart(2, '0'),
    ].join('-');
    const resultTime = [
        String(result.getUTCHours()).padStart(2, '0'),
        String(result.getUTCMinutes()).padStart(2, '0'),
    ].join(':');
    return { date: resultDate, time: resultTime };
}

/**
 * 按“乘车日期 + 发车时刻 + 历时”推导出发/到达日期。
 *
 * 直达余票里的 start_train_date 是列车始发日期，不能当作乘车日期使用。
 */
export function deriveTicketTiming(
    boardingDate: string,
    startTime: string,
    lishi: string
): TicketTiming | null {
    const duration = parseLishiMinutes(lishi);
    if (duration === null) {
        return null;
    }
    const start = addMinutes(boardingDate, startTime, 0);
    const arrive = addMinutes(boardingDate, startTime, duration);
    if (start === null || arrive === null) {
        return null;
    }
    return { start_date: start.date, arrive_date: arrive.date };
}

function exactSelection(code: string, catalog: StationCatalog): StationSelection {
    const station = catalog.byCode[code];
    const city = station?.city;
    const cityWideCodes =
        city !== undefined && hasOwn(catalog.byCity, city)
            ? catalog.byCity[city].map((entry) => entry.station_code)
            : [code];
    return {
        scope: 'exact',
        queryCode: code,
        allowedCodes: [code],
        cityWideCodes,
    };
}

function citySelection(
    city: string,
    catalog: StationCatalog
): StationSelection | null {
    const stations = catalog.byCity[city];
    if (stations === undefined) {
        return null;
    }
    const queryCode = hasOwn(catalog.cityCodes, city)
        ? catalog.cityCodes[city].station_code
        : stations[0]?.station_code;
    if (queryCode === undefined) {
        return null;
    }
    const allowedCodes = stations.map((station) => station.station_code);
    return {
        scope: 'city',
        queryCode,
        allowedCodes,
        cityWideCodes: allowedCodes,
        city,
    };
}

/**
 * 把用户输入解析为查询范围（issue #72 中的 auto 语义）：
 *
 * - 电报码（如 "VNP"）：精确到该站；
 * - 带“站”后缀的名称（如 "北京站"）：精确到该站，即使城市同名；
 * - 车站名（如 "北京南"）：精确到该站；
 * - 裸城市名（如 "北京"）：该城市所有车站。
 *
 * 具体站点名称和电报码不再退化为“同城范围”，避免把北京丰台的车次当成
 * 北京南的查询结果。
 *
 * preference 为 exact/city 时忽略输入形态，强制按指定范围解析，方便调用方
 * 用 get-station-code-of-citys 返回的代表站编码仍按整座城市查询。
 */
export function resolveStationSelection(
    input: string,
    catalog: StationCatalog,
    preference: StationScopePreference = 'auto'
): StationSelection | null {
    const raw = input.trim();
    if (raw === '') {
        return null;
    }
    const name = trimStationSuffix(raw);
    if (name === '') {
        return null;
    }
    const isTelecode = TELE_CODE_PATTERN.test(raw) && hasOwn(catalog.byCode, raw);
    const stationCode = isTelecode
        ? raw
        : hasOwn(catalog.byName, name)
          ? catalog.byName[name].station_code
          : undefined;
    if (preference === 'exact') {
        // 城市名按“与城市同名的那座车站”处理。
        if (isTelecode || hasOwn(catalog.byName, name)) {
            return exactSelection(stationCode!, catalog);
        }
        if (hasOwn(catalog.cityCodes, name)) {
            return exactSelection(
                catalog.cityCodes[name].station_code,
                catalog
            );
        }
        return null;
    }
    if (preference === 'city') {
        if (hasOwn(catalog.byCity, name)) {
            return citySelection(name, catalog);
        }
        if (stationCode !== undefined) {
            const city = catalog.byCode[stationCode]?.city;
            if (city !== undefined && hasOwn(catalog.byCity, city)) {
                return citySelection(city, catalog);
            }
            return exactSelection(stationCode, catalog);
        }
        return null;
    }
    if (isTelecode) {
        return exactSelection(raw, catalog);
    }
    if (
        hasOwn(catalog.byName, name) &&
        (raw.endsWith('站') || !hasOwn(catalog.byCity, name))
    ) {
        return exactSelection(catalog.byName[name].station_code, catalog);
    }
    if (hasOwn(catalog.byCity, name)) {
        return citySelection(name, catalog);
    }
    if (hasOwn(catalog.byName, name)) {
        return exactSelection(catalog.byName[name].station_code, catalog);
    }
    return null;
}

/**
 * 只保留实际起终点落在查询范围内的车次。必须在排序和截取数量之前调用，
 * 否则同城其他站的车次会挤掉真正匹配的结果。
 */
export function filterByStationCodes<T extends { from_station_telecode: string; to_station_telecode: string }>(
    tickets: T[],
    fromCodes: string[],
    toCodes: string[]
): T[] {
    return tickets.filter(
        (ticket) =>
            fromCodes.includes(ticket.from_station_telecode) &&
            toCodes.includes(ticket.to_station_telecode)
    );
}

function waitMinutesOf(candidate: InterlineCandidateLike): number | null {
    if (
        typeof candidate.wait_time_minutes === 'number' &&
        Number.isFinite(candidate.wait_time_minutes)
    ) {
        return candidate.wait_time_minutes;
    }
    if (typeof candidate.wait_time === 'string') {
        return parseChineseDurationMinutes(candidate.wait_time);
    }
    return null;
}

function isSameClock(derived: LocalDateTime, declaredTime: string): boolean {
    return derived.time === declaredTime.trim();
}

/**
 * 校验并推导一条中转方案的两段日期。
 *
 * 12306 的每条分段只给出时刻和历时，日期需要从查询日期出发逐段累加；再用
 * 顶层的 middle_date / arrive_date / all_lishi_minutes 交叉校验，任何一处
 * 对不上就整条丢弃，避免输出自相矛盾的行程。
 */
export function verifyInterlineCandidate(
    candidate: InterlineCandidateLike,
    queryDate: string,
    scope: InterlineScope
): InterlineCheck {
    const legs = candidate.fullList;
    if (legs.length !== 2) {
        return {
            ok: false,
            reason: `只支持两段行程，实际 ${legs.length} 段`,
        };
    }
    const [firstLeg, secondLeg] = legs;
    if (!scope.fromCodes.includes(firstLeg.from_station_telecode)) {
        return {
            ok: false,
            reason: `第一段出发站 ${firstLeg.from_station_telecode} 不在查询范围内`,
        };
    }
    if (!scope.toCodes.includes(secondLeg.to_station_telecode)) {
        return {
            ok: false,
            reason: `第二段到达站 ${secondLeg.to_station_telecode} 不在查询范围内`,
        };
    }
    if (scope.middleCodes !== null) {
        if (!scope.middleCodes.includes(firstLeg.to_station_telecode)) {
            return {
                ok: false,
                reason: `第一段到达站 ${firstLeg.to_station_telecode} 不在指定中转范围内`,
            };
        }
        if (!scope.middleCodes.includes(secondLeg.from_station_telecode)) {
            return {
                ok: false,
                reason: `第二段出发站 ${secondLeg.from_station_telecode} 不在指定中转范围内`,
            };
        }
    }
    if (candidate.train_date !== queryDate) {
        return {
            ok: false,
            reason: `返回的 train_date ${candidate.train_date} 与查询日期不一致`,
        };
    }
    const firstDuration = parseLishiMinutes(firstLeg.lishi);
    const secondDuration = parseLishiMinutes(secondLeg.lishi);
    if (firstDuration === null || secondDuration === null) {
        return { ok: false, reason: '分段历时无法解析' };
    }
    const waitMinutes = waitMinutesOf(candidate);
    if (waitMinutes === null || waitMinutes < 0) {
        return { ok: false, reason: '换乘等待时间无法解析' };
    }
    const firstStart = addMinutes(queryDate, firstLeg.start_time, 0);
    const firstArrive = addMinutes(queryDate, firstLeg.start_time, firstDuration);
    if (firstStart === null || firstArrive === null) {
        return { ok: false, reason: '第一段发车时刻无法解析' };
    }
    const secondStart = addMinutes(
        firstArrive.date,
        firstArrive.time,
        waitMinutes
    );
    if (secondStart === null) {
        return { ok: false, reason: '第二段发车时刻无法解析' };
    }
    const secondArrive = addMinutes(
        secondStart.date,
        secondStart.time,
        secondDuration
    );
    if (secondArrive === null) {
        return { ok: false, reason: '第二段到达时刻无法解析' };
    }

    // 时刻必须与上游给出的发车/到达时刻一致，否则说明等待时间或历时不可信。
    if (!isSameClock(firstArrive, firstLeg.arrive_time)) {
        return {
            ok: false,
            reason: `第一段到达时刻不一致：推导 ${firstArrive.time}，上游 ${firstLeg.arrive_time}`,
        };
    }
    if (!isSameClock(secondStart, secondLeg.start_time)) {
        return {
            ok: false,
            reason: `第二段发车时刻不一致：推导 ${secondStart.time}，上游 ${secondLeg.start_time}`,
        };
    }
    if (!isSameClock(secondArrive, secondLeg.arrive_time)) {
        return {
            ok: false,
            reason: `第二段到达时刻不一致：推导 ${secondArrive.time}，上游 ${secondLeg.arrive_time}`,
        };
    }
    // 日期必须与顶层的换乘日期、到达日期一致。
    if (secondStart.date !== candidate.middle_date) {
        return {
            ok: false,
            reason: `换乘日期不一致：推导 ${secondStart.date}，上游 ${candidate.middle_date}`,
        };
    }
    if (secondArrive.date !== candidate.arrive_date) {
        return {
            ok: false,
            reason: `到达日期不一致：推导 ${secondArrive.date}，上游 ${candidate.arrive_date}`,
        };
    }
    const totalMinutes = minutesBetween(firstStart, secondArrive);
    if (totalMinutes === null) {
        return { ok: false, reason: '总历时无法计算' };
    }
    if (
        typeof candidate.all_lishi_minutes === 'number' &&
        Number.isFinite(candidate.all_lishi_minutes) &&
        candidate.all_lishi_minutes !== totalMinutes
    ) {
        return {
            ok: false,
            reason: `总历时不一致：推导 ${totalMinutes} 分钟，上游 ${candidate.all_lishi_minutes} 分钟`,
        };
    }
    // 乘车日期不可能早于列车始发日期，也不应相差超过两天。
    const boardedDates: [string, string][] = [
        [firstStart.date, firstLeg.start_train_date],
        [secondStart.date, secondLeg.start_train_date],
    ];
    for (const [boardingDate, startTrainDate] of boardedDates) {
        if (!isBoardingAfterOrigin(boardingDate, startTrainDate)) {
            return {
                ok: false,
                reason: `乘车日期 ${boardingDate} 与列车始发日期 ${startTrainDate} 矛盾`,
            };
        }
    }
    return {
        ok: true,
        timing: {
            first: {
                start_date: firstStart.date,
                start_time: firstStart.time,
                arrive_date: firstArrive.date,
                arrive_time: firstArrive.time,
                lishi: firstLeg.lishi,
            },
            second: {
                start_date: secondStart.date,
                start_time: secondStart.time,
                arrive_date: secondArrive.date,
                arrive_time: secondArrive.time,
                lishi: secondLeg.lishi,
            },
            middle_date: secondStart.date,
            arrive_date: secondArrive.date,
            totalMinutes,
            waitMinutes,
        },
    };
}

/**
 * 两个墙钟时间之间的分钟数。
 */
export function minutesBetween(
    from: LocalDateTime,
    to: LocalDateTime
): number | null {
    const fromMs = toUtcMilliseconds(from);
    const toMs = toUtcMilliseconds(to);
    if (fromMs === null || toMs === null) {
        return null;
    }
    return Math.round((toMs - fromMs) / 60_000);
}

function toUtcMilliseconds(value: LocalDateTime): number | null {
    const dateMatch = DATE_PATTERN.exec(value.date.trim());
    const timeMatch = TIME_PATTERN.exec(value.time.trim());
    if (dateMatch === null || timeMatch === null) {
        return null;
    }
    return Date.UTC(
        parseInt(dateMatch[1], 10),
        parseInt(dateMatch[2], 10) - 1,
        parseInt(dateMatch[3], 10),
        parseInt(timeMatch[1], 10),
        parseInt(timeMatch[2], 10)
    );
}

function toUtcDay(date: string): number | null {
    const match = DATE_PATTERN.exec(date.trim());
    if (match === null) {
        return null;
    }
    const time = Date.UTC(
        parseInt(match[1], 10),
        parseInt(match[2], 10) - 1,
        parseInt(match[3], 10)
    );
    if (Number.isNaN(time)) {
        return null;
    }
    return Math.floor(time / 86_400_000);
}

/**
 * 乘车日期必须不早于列车始发日期，且最多相差两天（覆盖跨年夜、闰日等）。
 */
function isBoardingAfterOrigin(boardingDate: string, startTrainDate: string): boolean {
    const boardingDay = toUtcDay(boardingDate);
    const originDay = toUtcDay(
        `${startTrainDate.slice(0, 4)}-${startTrainDate.slice(4, 6)}-${startTrainDate.slice(6, 8)}`
    );
    if (boardingDay === null || originDay === null) {
        return false;
    }
    const diff = boardingDay - originDay;
    return diff >= 0 && diff <= 2;
}
