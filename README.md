# <div align="center">12306-mcp</div>

<div align="center">

[![](https://img.shields.io/badge/Joooook-blue.svg?logo=github&lable=python&labelColor=497568&color=497568&style=flat-square)](https://github.com/Joooook)
[![](https://img.shields.io/badge/Joooook-blue.svg?logo=bilibili&logoColor=white&lable=python&labelColor=af7a82&color=af7a82&style=flat-square)](https://space.bilibili.com/3546386788255839)
![](https://img.shields.io/badge/typescript-blue.svg?logo=typescript&lable=typescript&logoColor=white&labelColor=192c3b&color=192c3b&style=flat-square)
![](https://img.shields.io/github/stars/Joooook/12306-mcp?logo=reverbnation&lable=python&logoColor=white&labelColor=ffc773&color=ffc773&style=flat-square)
![](https://img.shields.io/github/last-commit/Joooook/12306-mcp.svg?style=flat-square)
![](https://img.shields.io/github/license/Joooook/12306-mcp.svg?style=flat-square&color=000000)
</div>

A 12306 ticket search server based on the Model Context Protocol (MCP). The server provides a simple API interface that allows users to search for 12306 tickets.

基于 Model Context Protocol (MCP) 的12306购票搜索服务器。提供了简单的API接口，允许大模型利用接口搜索12306购票信息。

**如需Skill -> https://github.com/Joooook/12306-skill**

## <div align="center">🚩Features</div>
<div align="center"> 

| 功能描述                         | 状态     |
|------------------------------|--------|
| 查询12306购票信息              | ✅ 已完成  |
| 过滤列车信息                   | ✅ 已完成  |
| 过站查询                      | ✅ 已完成 |
| 中转查询                      | ✅ 已完成 |
| 其余接口，欢迎提feature         | 🚧 计划内 |

</div>
<div align="center"> 
  <img src="https://s2.loli.net/2025/04/15/UjbrG5esaSEmJxN.jpg" width=800px/>
</div>
<div align="center"> 
  <img src="https://s2.loli.net/2025/04/15/rm1j8zX7sqiyafP.jpg" width=800px/>
</div>

## <div align="center">🔎查询范围与日期语义</div>

- **车站范围**：`get-tickets` / `get-interline-tickets` 的 `stationScope` 默认为 `auto`。传中文城市名（如“北京”）按整座城市查询，传具体车站名（如“北京南”）或 `station_code`（如 `VNP`）只查该站。若要把 `get-station-code-of-citys` 返回的代表站编码当作整座城市使用，请显式设置 `stationScope: "city"`。
- **结果过滤**：只保留实际出发站/到达站落在查询范围内的车次，且过滤发生在排序与 `limitedNum` 截取之前，同城其他站的车次不会挤掉正确结果。
- **乘车日期**：直达车次的乘车日期取查询日期，不再使用 `start_train_date`（列车始发日期，凌晨经过中间站时已是第二天）。中转方案按分段历时与换乘等待时间逐段推算换乘日期、到达日期，并与 12306 返回的 `middle_date` / `arrive_date` / `all_lishi_minutes` 交叉校验，自相矛盾的方案会被丢弃。
- **中转站点**：中转站按城市范围校验，同一城市内换站换乘（如郑州东 → 郑州）会保留。

## <div align="center">⚙️Installation</div>

~~~bash
git clone https://github.com/Joooook/12306-mcp.git
npm i
~~~


## <div align="center">▶️Quick Start</div>

### CLI-stdio
~~~bash
npx -y 12306-mcp
~~~

### CLI-http
~~~bash
npx -y 12306-mcp --port [端口号]
~~~

### Runtime requirements

The server requires Node.js 18 or newer. The `npm run debug` command uses
MCP Inspector 2.0.0, which requires Node.js 22.19.0 or newer.

### MCP sever configuration

~~~json
{
    "mcpServers": {
        "12306-mcp": {
            "command": "npx",
            "args": [
                "-y",
                "12306-mcp"
            ]
        }
    }
}

~~~

### Docker-stdio
~~~bash
docker build . -t 12306-mcp
docker run --rm -it 12306-mcp npx 12306-mcp
~~~

### Docker-http
~~~bash
docker build . -t 12306-mcp
docker run -p [your_port]:8080 -d 12306-mcp npx 12306-mcp --port 8080
~~~



## <div align="center">📚Documentation</div>

- [服务原理详解](./docs/principle.md)  12306-MCP服务的工作原理
- [架构图](./docs/architecture.md)  12306-MCP服务的架构图
   ![12306-MCP 服务架构图](./docs/architecture.png)

## <div align="center">👉️Reference</div>
- [modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)

## <div align="center">💭Murmurs</div>
本项目仅用于学习，欢迎催更。

## <div align="center">🎫Badges</div>
<div align="center"> 
<a href="https://glama.ai/mcp/servers/@Joooook/12306-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Joooook/12306-mcp/badge" alt="12306-mcp MCP server" />
</a>

[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/joooook-12306-mcp-badge.png)](https://mseep.ai/app/joooook-12306-mcp)

</div>

## <div align="center">☕️Donate</div>
请我喝杯奶茶吧。
<div align="center"> 
<a href="https://afdian.com/item/2a0e0cdcadf911ef9f725254001e7c00">
  <img src="https://s2.loli.net/2024/11/29/1JBxzphs7V6WcK9.jpg" width="500px">
</a>
</div>
