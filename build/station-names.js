// 车站名查询的输入清洗与输出构造。
//
// 这些函数从工具处理函数中抽出来，便于单元测试，同时集中处理两个问题：
// 1. 用户（或大模型）传入的任意文本不能原样回显到工具输出里（issue #74）；
// 2. 查询必须用 hasOwnProperty，避免 "constructor"、"toString" 等原型链属性
//    被当作已存在的车站/城市。
export const MAX_LOOKUP_NAMES = 20;
// 中文车站名允许的最大长度。最长站名远小于此值，留出余量。
const MAX_STATION_NAME_LENGTH = 20;
const STATION_NAME_PATTERN = /^[\u4e00-\u9fff]{1,20}$/;
/**
 * 只做原型链安全检查，不做长度限制。
 */
export function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}
/**
 * 清洗单个车站名/城市名：
 * - 去掉首尾空白；
 * - 去掉用户习惯性追加的“站”后缀；
 * - 只保留看起来像中文站名的输入（1-20 个汉字），其余返回 null。
 *
 * 返回 null 的输入不参与查询，也不会出现在工具输出中，因此调用方传来的
 * HTML、模板语法、控制字符等内容不会被回显。
 */
export function sanitizeStationName(rawName) {
    const trimmed = rawName.trim();
    const name = trimmed.endsWith('站')
        ? trimmed.substring(0, trimmed.length - 1)
        : trimmed;
    if (!STATION_NAME_PATTERN.test(name)) {
        return null;
    }
    return name;
}
/**
 * 按车站名（或城市名）批量查询，用于 get-station-code-by-names /
 * get-station-code-of-citys。最多处理 MAX_LOOKUP_NAMES 个名称。
 *
 * 未检索到的名称只在形如中文站名时以数组形式返回；不像站名的输入只计数，
 * 不回显。
 */
export function lookupStationNames(rawNames, stations) {
    const result = {
        found: {},
        notFound: [],
        ignoredCount: 0,
    };
    const names = rawNames.split('|').slice(0, MAX_LOOKUP_NAMES);
    for (const rawName of names) {
        const name = sanitizeStationName(rawName);
        if (name === null) {
            result.ignoredCount++;
            continue;
        }
        if (hasOwn(stations, name)) {
            result.found[name] = stations[name];
        }
        else {
            result.notFound.push(name);
        }
    }
    return result;
}
/**
 * 构造工具返回的 JSON 文本。未检索到的名称放在 notFound 数组里，被忽略的
 * 非法输入只给出数量。
 */
export function formatStationNameLookup(lookup) {
    const output = { ...lookup.found };
    if (lookup.notFound.length > 0) {
        output.notFound = lookup.notFound;
    }
    if (lookup.ignoredCount > 0) {
        output.ignoredCount = lookup.ignoredCount;
    }
    return JSON.stringify(output);
}
