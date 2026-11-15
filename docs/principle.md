# 12306-MCP 服务 原理

## 1. 启动初始化

### 1.1 车站数据加载

服务启动时通过 `getStations()` 函数从 12306 API 获取全国车站信息，构建四个核心索引：

**具体流程：**
1. 访问 12306 首页 (https://www.12306.cn/index/)
2. 从 HTML 中提取车站名称 JS 文件路径 
3. 下载并解析 JS 文件，获取原始车站数据
4. 补充缺失的车站信息 (MISSING_STATIONS)
5. 基于车站数据得到四个核心数据结构映射表

```typescript
// 1. 车站id -> 车站信息
STATIONS: Record<string, StationData>        

// "AAA": {
// "station_id": "@aaa",
// "station_name": "北京北",
// "station_code": "AAA",
// "station_pinyin": "beijingbei",
// "station_short": "aaa",
// "station_index": "0",
// "code": "1234",
// "city": "北京",
// "r1": "",
// "r2": ""
// }


//  2. 城市名 ->  车站id 和 站名 (可能一个城市多个站)
CITY_STATIONS: Record<string, { station_code: string; station_name: string }> 

// "北京": [{"station_code": "AAA","station_name": "北京北"},{"station_code": "BBB","station_name": "京东"},...]

// 3. 车站名(与城市名相同,只会有一个) -> 车站id 和 站名 
CITY_CODES: Record<string, { station_code: string; station_name: string }>      

// "北京":{"station_code":"CCC","station_name":"北京"}

// 4. 车站名 ->  车站id 和 站名
NAME_STATIONS: Record<string, { station_code: string; station_name: string }>   

// "北京北":{"station_code":"AAA","station_name":"北京北"}

```

## 2. MCP tools

### 2.1 基础tool

- **`get-current-date`**: 获取上海时区当前日期
  - 返回当前上海时区的时间日期字符串("yyyy-MM-dd")
  - 为其他工具提供准确的查询日期基准

- **`get-stations-code-in-city`**: 查询城市内所有车站（使用 `CITY_STATIONS`）
  - 输入：中文城市名
  - 查找：`CITY_STATIONS[city]` 获取该城市所有车站列表
  - 返回：包含 `station_code` 和 `station_name` 的数组
    
- **`get-station-code-of-citys`**: 获取城市代表车站id（使用 `CITY_CODES`）
  - 输入：城市名（支持 "|" 分隔的多个城市）
  - 查找：`CITY_CODES[city]` 获取与城市同名的主要车站
  - 返回：每个城市对应的代表车站信息

- **`get-station-code-by-names`**: 车站名转车站id（使用 `NAME_STATIONS`）
  - 输入：具体车站名（支持 "|" 分隔的多个车站）
  - 查找：`NAME_STATIONS[stationName]` 精确匹配车站名
  - 返回：车站id和车站名

- **`get-station-by-telecode`**: 车站id查车站信息（使用 `STATIONS`）
  - 输入：车站id
  - 查找：`STATIONS[telecode]` 获取完整车站信息
  - 返回：包含拼音、城市等详细信息

### 2.2 核心tool (输入可通过基础tool获取)

- **`get-tickets`**: 查询12306余票信息
  - 输入：出发日期、出发站id、到达站id、车次类型筛选、`stationScope`
  - 参数处理：检查日期不早于当前日期，验证车站id存在性, 构造请求入参
  - 范围解析：`stationScope` 为 `auto`（默认）时，中文城市名查询该城市所有车站，车站名或 `station_code` 只查该站；`exact` / `city` 可强制指定范围（城市工具返回的代表站编码可用 `city` 当整座城市使用）
  - 范围过滤：只保留实际起终点落在查询范围内的车次，且过滤发生在排序与 `limitedNum` 截取之前，避免同城其他站的车次挤掉正确结果
  - 日期推算：乘车日期取查询日期、到达日期按历时推算，不使用 `start_train_date`（它是列车始发日期，列车凌晨经过中间站时已是第二天）
  - Cookie 处理：先获取 12306 Cookie 用于身份验证
  - API 调用：访问 `/otn/leftTicket/query` 接口
  - 数据处理, 车次类型筛选
  - 返回格式化数据

- **`get-interline-tickets`**: 中转换乘查询，支持指定中转站
  - 输入：出发站id、到达站id、中转站id、是否显示无座、车次类型筛选、`stationScope`
  - 参数处理：检查日期不早于当前日期，验证车站id存在性, 构造请求入参
  - 日期推算：第一段按查询日期发车，第二段发车时间 = 第一段到达 + 换乘等待时间，到达时间逐段累加；结果用上游的 `middle_date`、`arrive_date`、`all_lishi_minutes` 交叉校验，任何一项对不上就丢弃该方案
  - 范围校验：两段的实际出发/到达站必须落在查询范围内，中转站按城市范围校验（12306 本身按城市返回换站换乘方案）
  - 分页：以“通过校验和筛选的候选数”决定是否继续翻页，单页全部被过滤时不会误判为无结果
  - Cookie 处理：先获取 12306 Cookie 用于身份验证
  - API 调用：访问 `/lcquery/queryU` 接口
  - 数据处理, 车次类型筛选
  - 返回格式化数据

- **`get-train-route-stations`**: 列车经停站查询
  - 输入：车次编码(可以调用get-tickets获取)、出发站id、到达站id、出发日期
  - 参数处理：检查日期不早于当前日期，验证车站id存在性, 构造请求入参
  - Cookie 处理：先获取 12306 Cookie 用于身份验证
  - API 调用：访问 `/otn/czxx/queryByTrainNo` 接口
  - 返回格式化数据

## 3. 数据流程与工具关系

### 3.1 车票查询流程

```
用户查询 "后天北京到上海的高铁" - 大模型调用流程：
    ↓
1. get-current-date() → "2024-01-15" (获取当前日期)
2. 大模型理解后天日期 → "2024-01-17"
3. get-station-code-of-citys("北京|上海") → {"北京": {"station_code": "BJP","station_name": "北京"}, "上海": {"station_code": "SHH","station_name": "上海"}}
    ↓
4. get-tickets(date: "2024-01-17", fromStation: "BJP", toStation: "SHH", trainFilterFlags: "G", stationScope: "city")
   （按城市查询：要么直接传中文城市名，要么传代表站编码并指定 stationScope=city）
    ↓
5. 内部数据处理(参数验证, 查询范围解析, Cookie获取, API调用, 日期推算与范围过滤, 格式化输出文本)
    ↓
6. 返回格式化的高铁车次信息（车次、时间、价格、余票等），只包含实际起终点在查询范围内的车次
```

### 3.2 中转查询流程

```
用户查询 "深圳到拉萨，经过西安中转"
    ↓
1. 获取三个城市的车站id
2. get-interline-tickets(from: "SZQ", to: "LSO", transfer: "XAY")
    ↓
3. 内部数据处理(参数验证, Cookie获取, API调用, 格式化输出文本)
    ↓
4. 返回中转方案（第一程 + 第二程）
```

### 3.3 经停站查询流程

```
用户查询 "G1次列车经停哪些站"
    ↓
1. get-train-route-stations(trainNo: "G1", from: "BJP", to: "SHH")
    ↓
2. 数据处理：parseRouteStationsData() → parseRouteStationsInfo()
    ↓
3. 返回经停站列表（站名、到达时间、出发时间、停留时间）
```

### 3.4 工具依赖关系

```
基础工具层：
├── get-current-date 
├── get-stations-code-in-city 
└── get-station-code-of-citys 
└── get-station-code-by-names 
└── get-station-by-telecode 

     ↓ 为核心工具层提供基础数据

核心工具层：
├── get-tickets (依赖车站id)
├── get-interline-tickets (依赖车站id)
└── get-train-route-stations (依赖车站id和车次号)
```

