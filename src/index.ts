#!/usr/bin/env node

// Data一般用于表示从服务器上请求到的数据，Info一般表示解析并筛选过的要传输给大模型的数据。变量使用驼峰命名，常量使用全大写下划线命名。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import axios from 'axios';
import { z } from 'zod';
import { format } from 'date-fns'; 
import { toZonedTime } from 'date-fns-tz'; 
import {
  Price,
  RouteStationData,
  RouteStationInfo,
  StationData,
  StationDataKeys,
  TicketData,
  TicketDataKeys,
  TicketInfo,
} from './types.js';

const API_BASE = 'https://kyfw.12306.cn';
const WEB_URL = 'https://www.12306.cn/index/';
const MISSING_STATIONS: StationData[] = [
  {
    station_id: '@cdd',
    station_name: '成  都东',
    station_code: 'WEI',
    station_pinyin: 'chengdudong',
    station_short: 'cdd',
    station_index: '',
    code: '1707',
    city: '成都',
    r1: '',
    r2: '',
  },
];
const STATIONS: Record<string, StationData> = await getStations(); //以Code为键
const CITY_STATIONS: Record<
  string,
  { station_code: string; station_name: string }[]
> = (() => {
  const result: Record<
    string,
    { station_code: string; station_name: string }[]
  > = {};
  for (const station of Object.values(STATIONS)) {
    const city = station.city;
    if (!result[city]) {
      result[city] = [];
    }
    result[city].push({
      station_code: station.station_code,
      station_name: station.station_name,
    });
  }
  return result;
})(); //以城市名名为键，位于该城市的的所有Station列表的记录

const CITY_CODES: Record<
  string,
  { station_code: string; station_name: string }
> = (() => {
  const result: Record<string, { station_code: string; station_name: string }> =
    {};
  for (const [city, stations] of Object.entries(CITY_STATIONS)) {
    for (const station of stations) {
      if (station.station_name == city) {
        result[city] = station;
        break;
      }
    }
  }
  return result;
})(); //以城市名名为键的Station记录

const NAME_STATIONS: Record<
  string,
  { station_code: string; station_name: string }
> = (() => {
  const result: Record<string, { station_code: string; station_name: string }> =
    {};
  for (const station of Object.values(STATIONS)) {
    const station_name = station.station_name;
    result[station_name] = {
      station_code: station.station_code,
      station_name: station.station_name,
    };
  }
  return result;
})(); //以车站名为键的Station记录

const SEAT_SHORT_TYPES = {
  swz: '商务座',
  tz: '特等座',
  zy: '一等座',
  ze: '二等座',
  gr: '高软卧',
  srrb: '动卧',
  rw: '软卧',
  yw: '硬卧',
  rz: '软座',
  yz: '硬座',
  wz: '无座',
  qt: '其他',
  gg: '',
  yb: '',
};

const SEAT_TYPES = {
  '9': { name: '商务座', short: 'swz' },
  P: { name: '特等座', short: 'tz' },
  M: { name: '一等座', short: 'zy' },
  D: { name: '优选一等座', short: 'zy' },
  O: { name: '二等座', short: 'ze' },
  S: { name: '二等包座', short: 'ze' },
  '6': { name: '高级软卧', short: 'gr' },
  A: { name: '高级动卧', short: 'gr' },
  '4': { name: '软卧', short: 'rw' },
  I: { name: '一等卧', short: 'rw' },
  F: { name: '动卧', short: 'rw' },
  '3': { name: '硬卧', short: 'yw' },
  J: { name: '二等卧', short: 'yw' },
  '2': { name: '软座', short: 'rz' },
  '1': { name: '硬座', short: 'yz' },
  W: { name: '无座', short: 'wz' },
  WZ: { name: '无座', short: 'wz' },
  H: { name: '其他', short: 'qt' },
};

const DW_FLAGS = [
  '智能动车组',
  '复兴号',
  '静音车厢',
  '温馨动卧',
  '动感号',
  '支持选铺',
  '老年优惠',
];

const TRAIN_FILTERS = {
  G: (ticketInfo: TicketInfo) => {
    return ticketInfo.start_train_code.startsWith('G') || 
           ticketInfo.start_train_code.startsWith('C')   
           ? true
           : false;
  },
  D: (ticketInfo: TicketInfo) => {
    return ticketInfo.start_train_code.startsWith('D') ? true : false;
  },
  Z: (ticketInfo: TicketInfo) => {
    return ticketInfo.start_train_code.startsWith('Z') ? true : false; 
  },
  T: (ticketInfo: TicketInfo) => {
    return ticketInfo.start_train_code.startsWith('T') ? true : false; 
  },
  K: (ticketInfo: TicketInfo) => {
    return ticketInfo.start_train_code.startsWith('K') ? true : false; 
  },
  O: (ticketInfo: TicketInfo) => {
    return TRAIN_FILTERS.G(ticketInfo) ||
           TRAIN_FILTERS.D(ticketInfo) ||
           TRAIN_FILTERS.Z(ticketInfo) ||
           TRAIN_FILTERS.T(ticketInfo) ||
           TRAIN_FILTERS.K(ticketInfo)
           ? false
           : true;
  },
  F: (ticketInfo: TicketInfo) => { // 
    return ticketInfo.dw_flag.includes('复兴号') ? true : false;
  },
  S: (ticketInfo: TicketInfo) => { // 
    return ticketInfo.dw_flag.includes('智能动车组') ? true : false;
  },
};
function parseCookies(cookies: Array<string>): Record<string, string> {
  const cookieRecord: Record<string, string> = {};
  cookies.forEach((cookie) => {
    // 提取键值对部分（去掉 Path、HttpOnly 等属性）
    const keyValuePart = cookie.split(';')[0];
    // 分割键和值
    const [key, value] = keyValuePart.split('=');
    // 存入对象
    if (key && value) {
      cookieRecord[key.trim()] = value.trim();
    }
  });
  return cookieRecord;
}

function formatCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function getCookie(url: string) {
  try {
    const response = await axios.get(url);
    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader) {
      return parseCookies(setCookieHeader);
    }
    return null;
  } catch (error) {
    console.error('Error making 12306 request:', error);
    return null;
  }
}

function parseRouteStationsData(rawData: Object[]): RouteStationData[] {
  const result: RouteStationData[] = [];
  for (const item of rawData) {
    result.push(item as RouteStationData);
  }
  return result;
}

function parseRouteStationsInfo(
  routeStationsData: RouteStationData[]
): RouteStationInfo[] {
  const result: RouteStationInfo[] = [];
  routeStationsData.forEach((routeStationData, index) => {
    if (index == 0) {
      result.push({
        arrive_time: routeStationData.start_time,
        station_name: routeStationData.station_name,
        stopover_time: routeStationData.stopover_time,
        station_no: parseInt(routeStationData.station_no),
      });
    } else {
      result.push({
        arrive_time: routeStationData.arrive_time,
        station_name: routeStationData.station_name,
        stopover_time: routeStationData.stopover_time,
        station_no: parseInt(routeStationData.station_no),
      });
    }
  });
  return result;
}

function parseTicketsData(rawData: string[]): TicketData[] {
  const result: TicketData[] = [];
  for (const item of rawData) {
    const values = item.split('|');
    const entry: Partial<TicketData> = {};
    TicketDataKeys.forEach((key, index) => {
      entry[key] = values[index];
    });
    result.push(entry as TicketData);
  }
  return result;
}

function parseTicketsInfo(ticketsData: TicketData[]): TicketInfo[] {
  const result: TicketInfo[] = [];
  for (const ticket of ticketsData) {
    const prices = extractPrices(ticket);
    const dw_flag = extractDWFlags(ticket);
    result.push({
      train_no: ticket.train_no,
      start_train_code: ticket.station_train_code,
      start_time: ticket.start_time,
      arrive_time: ticket.arrive_time,
      lishi: ticket.lishi,
      from_station: STATIONS[ticket.from_station_telecode].station_name,
      to_station: STATIONS[ticket.to_station_telecode].station_name,
      from_station_telecode: ticket.from_station_telecode,
      to_station_telecode: ticket.to_station_telecode,
      prices: prices,
      dw_flag: dw_flag,
    });
  }
  return result;
}

function formatTicketsInfo(ticketsInfo: TicketInfo[]): string {
  if (ticketsInfo.length === 0) {
    return '没有查询到相关车次信息';
  }
  let result = '车次 | 出发站 -> 到达站 | 出发时间 -> 到达时间 | 历时 |';
  ticketsInfo.forEach((ticketInfo) => {
    let infoStr = '';
    infoStr += `${ticketInfo.start_train_code}(实际车次train_no: ${ticketInfo.train_no}) ${ticketInfo.from_station}(telecode: ${ticketInfo.from_station_telecode}) -> ${ticketInfo.to_station}(telecode: ${ticketInfo.to_station_telecode}) ${ticketInfo.start_time} -> ${ticketInfo.arrive_time} 历时：${ticketInfo.lishi}`;
    ticketInfo.prices.forEach((price) => {
      infoStr += `\n- ${price.seat_name}: ${
        price.num.match(/^\d+$/) ? price.num + '张' : price.num
      }剩余 ${price.price}元`;
    });
    result += `${infoStr}\n`;
  });
  return result;
}

function filterTicketsInfo(
  ticketsInfo: TicketInfo[],
  filters: string
): TicketInfo[] {
  if (filters.length === 0) {
    return ticketsInfo;
  }
  const result: TicketInfo[] = [];
  for (const ticketInfo of ticketsInfo) {
    for (const filter of filters) {
      if (TRAIN_FILTERS[filter as keyof typeof TRAIN_FILTERS](ticketInfo)) {
        result.push(ticketInfo);
        break;
      }
    }
  }
  return result;
}

function parseStationsData(rawData: string): Record<string, StationData> {
  const result: Record<string, StationData> = {};
  const dataArray = rawData.split('|');
  const dataList: string[][] = [];
  for (let i = 0; i < Math.floor(dataArray.length / 10); i++) {
    dataList.push(dataArray.slice(i * 10, i * 10 + 10));
  }
  for (const group of dataList) {
    let station: Partial<StationData> = {};
    StationDataKeys.forEach((key, index) => {
      station[key] = group[index];
    });
    if (!station.station_code) {
      continue;
    }
    result[station.station_code!] = station as StationData;
  }
  return result;
}

function extractPrices(ticketData: TicketData): Price[] {
  const PRICE_STR_LENGTH = 10;
  const DISCOUNT_STR_LENGTH = 5;

  const yp_ex = ticketData.yp_ex;
  const yp_info_new = ticketData.yp_info_new;
  const seat_discount_info = ticketData.seat_discount_info;

  const prices: { [key: string]: Price } = {};
  const discounts: { [key: string]: number } = {};
  for (let i = 0; i < seat_discount_info.length / DISCOUNT_STR_LENGTH; i++) {
    const discount_str = seat_discount_info.slice(
      i * DISCOUNT_STR_LENGTH,
      (i + 1) * DISCOUNT_STR_LENGTH
    );
    discounts[discount_str[0]] = parseInt(discount_str.slice(1), 10);
  }

  const exList = yp_ex.split(/[01]/).filter(Boolean); // Remove empty strings
  exList.forEach((ex, index) => {
    const seat_type = SEAT_TYPES[ex as keyof typeof SEAT_TYPES];
    const price_str = yp_info_new.slice(
      index * PRICE_STR_LENGTH,
      (index + 1) * PRICE_STR_LENGTH
    );
    const price = parseInt(price_str.slice(1, -5), 10);
    const discount = ex in discounts ? discounts[ex] : null;
    prices[ex] = {
      seat_name: seat_type.name,
      short: seat_type.short,
      seat_type_code: ex,
      num: ticketData[`${seat_type.short}_num` as keyof TicketData],
      price,
      discount,
    };
  });

  return Object.values(prices);
}

function extractDWFlags(ticketData: TicketData): string[] {
  const dwFlagList = ticketData.dw_flag.split('#');
  let result = [];
  if ('5' == dwFlagList[0]) {
    result.push(DW_FLAGS[0]);
  }
  if (dwFlagList.length > 1 && '1' == dwFlagList[1]) {
    result.push(DW_FLAGS[1]);
  }
  if (dwFlagList.length > 2) {
    if ('Q' == dwFlagList[2].substring(0, 1)) {
      result.push(DW_FLAGS[2]);
    } else if ('R' == dwFlagList[2].substring(0, 1)) {
      result.push(DW_FLAGS[3]);
    }
  }
  if (dwFlagList.length > 5 && 'D' == dwFlagList[5]) {
    result.push(DW_FLAGS[4]);
  }
  if (dwFlagList.length > 6 && 'z' != dwFlagList[6]) {
    result.push(DW_FLAGS[5]);
  }
  if (dwFlagList.length > 7 && 'z' != dwFlagList[7]) {
    result.push(DW_FLAGS[6]);
  }
  return result;
}

async function make12306Request<T>(
  url: string | URL,
  scheme: URLSearchParams = new URLSearchParams(),
  headers: Record<string, string> = {}
): Promise<T | null> {
  try {
    const response = await axios.get(url + '?' + scheme.toString(), {
      headers: headers,
    });
    return (await response.data) as T;
  } catch (error) {
    console.error('Error making 12306 request:', error);
    return null;
  }
}

// Create server instance
const server = new McpServer({
  name: '12306-mcp',
  version: '1.0.0',
  capabilities: {
    resources: {},
    tools: {},
  },
  instructions:
    '你是一个12306火车票务助手。你的主要任务是帮助用户查询火车票信息、特定列车的经停站信息以及相关的车站信息。请仔细理解用户的意图，并按以下指引选择合适的工具：\n\n' +
    '**核心场景：查询两地之间的火车票**\n' +
    '1.  **日期处理**: 用户可能会使用相对日期（如“明天”、“下周五”）。此时，你必须先调用 `get-current-date` 工具获取当前日期（上海时区，格式 "yyyy-MM-dd"），然后基于此计算出用户指定的具体日期。\n' +
    '2.  **地点处理 (获取 station_code)**: `get-tickets` 工具需要的是 `station_code` 而不是中文地名。\n' +
    '    *   如果用户提供的是 **城市名** (如“衡阳”、“北京”)，使用 `get-station-code-of-city` 工具将其转换为对应城市的 `station_code`。\n' +
    '    *   如果用户提供的是 **具体车站名** (如“衡阳东站”、“北京南站”)，使用 `get-station-code-by-name` 工具将其转换为该车站的 `station_code`。\n' +
    '    *   **严禁直接使用中文地名作为 `get-tickets` 工具的 `fromStation` 或 `toStation` 参数。**\n' +
    '3.  **车票查询**: 获得准确的日期和出发地/到达地的 `station_code` 后，调用 `get-tickets` 工具进行查询。\n' +
    '    *   如果用户指定了列车类型（如“高铁”、“动车”），请在 `get-tickets` 的 `trainFilterFlags` 参数中设置相应的值 (如 "G" 代表高铁/城际，"D" 代表动车)。\n\n' +
    '**其他场景与工具使用：**\n' +
    '*   **查询特定列车经停站**: 如果用户想知道某趟具体列车（如 G123）会经过哪些车站及其到发时间，请使用 `get-train-route-stations` 工具。\n' +
    '    *   此工具需要 `train_no` (实际车次编号，通常可从 `get-tickets` 的结果中获得，或用户直接提供)、出发站和到达站的 `station_telecode` (注意，这里的 `telecode` 通常就是你通过地点处理步骤获得的 `station_code`) 以及列车的出发日期。\n' +
    '*   **查询城市内的所有车站**: 如果用户想了解某个城市有哪些火车站，可以使用 `get-stations-code-in-city` 工具。这会返回一个列表。\n' +
    '*   **通过车站电报码查询车站信息**: 如果有特殊需求或已知车站的 `station_telecode` (通常是3位字母编码)，可以使用 `get-station-by-telecode` 工具查询该车站的详细信息。这在一般用户查询中较少直接用到。\n\n' +
    '**通用原则：**\n' +
    '*   **优先理解意图**：根据用户的提问判断其真实需求，是查票、查经停站还是查车站信息。\n' +
    '*   **参数准确性**：确保传递给每个工具的参数格式和类型都正确，特别是日期格式和地点编码。\n' +
    '*   **必要时追问**：如果用户信息不足以调用工具（例如，只说了“北京到上海”，没说日期），请向用户追问缺失的信息。\n' +
    '*   **清晰呈现结果**：将工具返回的信息以用户易于理解的方式进行组织和呈现。\n\n' +
    '请根据上述指引，智能地选择和调用工具。',
});

interface QueryResponse {
  [key: string]: any;
  httpstatus: string;
  data: {
    [key: string]: any;
  };
  messages: string;
  status: boolean;
}

server.resource('stations', 'data://all-stations', async (uri) => ({
  contents: [{ uri: uri.href, text: JSON.stringify(STATIONS) }],
}));

server.tool(
  'get-current-date', 
  '获取当前日期，以上海时区（Asia/Shanghai, UTC+8）为准，返回格式为 "yyyy-MM-dd"。主要用于解析用户提到的相对日期（如“明天”、“下周三”），以便为其他需要日期的工具（如 `get-tickets` 或 `get-train-route-stations`）提供准确的日期输入。',
  {}, 
  async () => {
    try {
      const timeZone = 'Asia/Shanghai';
      const nowInShanghai = toZonedTime(new Date(), timeZone);
      const formattedDate = format(nowInShanghai, 'yyyy-MM-dd');
      return {
        content: [{ type: 'text', text: formattedDate }],
      };
    } catch (error) {
      console.error('Error getting current date:', error);
      return {
        content: [{ type: 'text', text: 'Error: Failed to get current date.' }],
      };
    }
  }
);

server.tool(
  'get-stations-code-in-city',
  '通过中文城市名查询该城市 **所有** 火车站的名称及其对应的 `station_code`，结果是一个包含多个车站信息的列表。当用户想了解一个城市有哪些火车站，或者不确定具体从哪个车站出发/到达时可以使用此工具。',
  {
    city: z.string().describe('中文城市名称'),
  },
  async ({ city }) => {
    if (!(city in CITY_STATIONS)) {
      return {
        content: [{ type: 'text', text: 'Error: City not found. ' }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(CITY_STATIONS[city]) }],
    };
  }
);

server.tool(
  'get-station-code-of-city',
  '通过中文城市名（如“衡阳”）查询该城市 **主要或默认火车站** 的 `station_code` 和车站名，结果是唯一的。此工具主要用于在用户提供城市名作为出发地或到达地时，为 `get-tickets` 工具准备 `station_code` 参数。',
  {
    city: z.string().describe('中文城市名称，例如："北京", "上海"'),
  },
  async ({ city }) => {
    if (!(city in CITY_CODES)) {
      return {
        content: [{ type: 'text', text: 'Error: City not found. ' }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(CITY_CODES[city]) }],
    };
  }
);

server.tool(
  'get-station-code-by-name',
  '通过具体的中文车站名（如“衡阳东站”）查询其 `station_code` 和车站名，结果是唯一的。此工具主要用于在用户提供具体车站名作为出发地或到达地时，为 `get-tickets` 工具准备 `station_code` 参数。',
  {
    stationName: z.string().describe('具体的中文车站名称，例如："北京南", "上海虹桥" (如果用户说了“衡阳东站”，就用“衡阳东”)'),
  },
  async ({ stationName }) => {
    stationName = stationName.endsWith('站')
      ? stationName.substring(0, -1)
      : stationName;
    if (!(stationName in NAME_STATIONS)) {
      return {
        content: [{ type: 'text', text: 'Error: Station not found. ' }],
      };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(NAME_STATIONS[stationName]) },
      ],
    };
  }
);

server.tool(
  'get-station-by-telecode',
  '通过车站的 `station_telecode` (通常是3位字母编码) 查询车站的详细信息，包括名称、拼音、所属城市等。此工具主要用于在已知 `telecode` 的情况下获取更完整的车站数据，或用于特殊查询及调试目的。一般用户对话流程中较少直接触发。',
  {
    stationTelecode: z.string().describe('车站的 `station_telecode` (3位字母编码)'),
  },
  async ({ stationTelecode }) => {
    if (!STATIONS[stationTelecode]) {
      return {
        content: [{ type: 'text', text: 'Error: Station not found. ' }],
      };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(STATIONS[stationTelecode]) },
      ],
    };
  }
);

server.tool(
  'get-tickets',
  '查询12306余票信息。重要提示：调用此工具前，必须确保 `date` 参数是 "yyyy-MM-dd" 格式（若用户提供相对日期，先用 `get-current-date` 获取并计算），并且 `fromStation` 和 `toStation` 参数必须是 `station_code`（若用户提供中文地名，先用 `get-station-code-by-name` 或 `get-station-code-of-city` 获取）。',
  {
    date: z.string().length(10).describe('查询日期，格式为 "yyyy-MM-dd"。如果用户提供的是相对日期（如“明天”），请务必先调用 `get-current-date` 工具获取当前日期，并计算出目标日期。'),
    fromStation: z
      .string()
      .describe('出发地的 `station_code` 。必须是通过 `get-station-code-by-name` 或 `get-station-code-of-city` 工具查询得到的编码，严禁直接使用中文地名。'),
    toStation: z
      .string()
      .describe('到达地的 `station_code` 。必须是通过 `get-station-code-by-name` 或 `get-station-code-of-city` 工具查询得到的编码，严禁直接使用中文地名。'),
    trainFilterFlags: z
      .string()
      .regex(/^[GDZTKOFS]*$/)
      .max(8)
      .optional()
      .default('')
      .describe(
        '车次筛选条件，默认为空。例如用户说“高铁票”，则应使用 "G"。可选标志：[G(高铁/城际),D(动车),Z(直达特快),T(特快),K(快速),O(其他),F(复兴号),S(智能动车组)]'
      ),
  },
  async ({ date, fromStation, toStation, trainFilterFlags }) => {
    // 检查日期是否早于当前日期
    if (new Date(date).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0)) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: The date cannot be earlier than today.',
          },
        ],
      };
    }
    if (
      !Object.keys(STATIONS).includes(fromStation) ||
      !Object.keys(STATIONS).includes(toStation)
    ) {
      return {
        content: [{ type: 'text', text: 'Error: Station not found. ' }],
      };
    }
    const queryParams = new URLSearchParams({
      'leftTicketDTO.train_date': date,
      'leftTicketDTO.from_station': fromStation,
      'leftTicketDTO.to_station': toStation,
      purpose_codes: 'ADULT',
    });
    const queryUrl = `${API_BASE}/otn/leftTicket/query`;
    const cookies = await getCookie(API_BASE);
    if (cookies == null) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: get cookie failed. Check your network.',
          },
        ],
      };
    }
    const queryResponse = await make12306Request<QueryResponse>(
      queryUrl,
      queryParams,
      { Cookie: formatCookies(cookies) }
    );
    if (queryResponse === null || queryResponse === undefined) {
      return {
        content: [{ type: 'text', text: 'Error: get tickets data failed. ' }],
      };
    }
    const ticketsData = parseTicketsData(queryResponse.data.result);
    let ticketsInfo: TicketInfo[];
    try {
      ticketsInfo = parseTicketsInfo(ticketsData);
    } catch (error) {
      return {
        content: [{ type: 'text', text: 'Error: parse tickets info failed. ' }],
      };
    }
    const filteredTicketsInfo = filterTicketsInfo(
      ticketsInfo,
      trainFilterFlags
    );
    return {
      content: [{ type: 'text', text: formatTicketsInfo(filteredTicketsInfo) }],
    };
  }
);

server.tool(
  'get-train-route-stations',
  '查询特定列车车次在指定区间内的途径车站、到站时间、出发时间及停留时间等详细经停信息。当用户询问某趟具体列车的经停站时使用此工具。',
  {
    trainNo: z.string().describe('要查询的实际车次编号 `train_no`，例如 "240000G10336"。此编号通常可以从 `get-tickets` 的查询结果中获取，或者由用户直接提供。'),
    fromStationTelecode: z
      .string()
      .describe('该列车行程的出发站的 `station_telecode` (3位字母编码，即 `station_code`)。此 `telecode` 通常来自 `get-tickets` 结果中的 `from_station_telecode` 字段，或者通过 `get-station-code-by-name`/`get-station-code-of-city` 转换用户提供的车站名得到。'),
    toStationTelecode: z
      .string()
      .describe('该列车行程的到达站的 `station_telecode` (3位字母编码，即 `station_code`)。获取方式同 `fromStationTelecode`。'),
    departDate: z
      .string()
      .length(10)
      .describe('列车从 `fromStationTelecode` 指定的车站出发的日期 (格式: yyyy-MM-dd)。如果用户提供的是相对日期，请务必先调用 `get-current-date` 解析。'),
  },
  async ({
    trainNo: trainNo,
    fromStationTelecode,
    toStationTelecode,
    departDate,
  }) => {
    const queryParams = new URLSearchParams({
      train_no: trainNo,
      from_station_telecode: fromStationTelecode,
      to_station_telecode: toStationTelecode,
      depart_date: departDate,
    });
    const queryUrl = `${API_BASE}/otn/czxx/queryByTrainNo`;
    const cookies = await getCookie(API_BASE);
    if (cookies == null) {
      return {
        content: [{ type: 'text', text: 'Error: get cookie failed. ' }],
      };
    }
    const queryResponse = await make12306Request<QueryResponse>(
      queryUrl,
      queryParams,
      { Cookie: formatCookies(cookies) }
    );
    if (queryResponse == null) {
      return {
        content: [
          { type: 'text', text: 'Error: get train route stations failed. ' },
        ],
      };
    }
    const routeStationsData = parseRouteStationsData(queryResponse.data.data);
    const routeStationsInfo = parseRouteStationsInfo(routeStationsData);
    return {
      content: [{ type: 'text', text: JSON.stringify(routeStationsInfo) }],
    };
  }
);

async function getStations(): Promise<Record<string, StationData>> {
  const html = await make12306Request<string>(WEB_URL);
  if (html == null) {
    throw new Error('Error: get 12306 web page failed.');
  }
  const match = html.match('.(/script/core/common/station_name.+?.js)');
  if (match == null) {
    throw new Error('Error: get station name js file failed.');
  }
  const stationNameJSFilePath = match[0];
  const stationNameJS = await make12306Request<string>(
    new URL(stationNameJSFilePath, WEB_URL)
  );
  if (stationNameJS == null) {
    throw new Error('Error: get station name js file failed.');
  }
  const rawData = eval(stationNameJS.replace('var station_names =', ''));
  const stationsData = parseStationsData(rawData);
  // 加上缺失的车站信息
  for (const station of MISSING_STATIONS) {
    if (!stationsData[station.station_code]) {
      stationsData[station.station_code] = station;
    }
  }
  return stationsData;
}

async function init() {}

async function main() {
  const transport = new StdioServerTransport();
  await init();
  await server.connect(transport);
  console.error('12306 MCP Server running on stdio @Joooook');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
