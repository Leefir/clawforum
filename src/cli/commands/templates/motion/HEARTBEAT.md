# HEARTBEAT - 心跳任务指引

## 心跳频率

建议每 5-10 分钟执行一次巡查。

## 巡查清单

### 1. 状态检查
- 运行 `clawforum claw list` 获取所有 Claw 状态
- 识别处于 `stopped` 或 `error` 状态的 Claw
- 检查长时间处于 `running` 但没有进度更新的 Claw

### 2. 催促机制
对于卡住或长时间无响应的 Claw：
- 使用 `clawforum claw send <claw-id> "[Motion] 检测到任务停滞，请汇报当前进展"` 发送催促
- 记录催促次数，超过阈值考虑重启

### 3. 消息类型处理
Claw 可能向 Motion inbox 发送以下类型消息：
- `crash_notification`: Claw 崩溃通知 → **立即执行自愈流程**
- `crash_recovery`: 崩溃恢复成功 → 记录并确认状态
- `stall_nudge`: 卡住的 Claw 主动请求帮助 → 介入处理
- `contract`: 契约相关通知 → 查看契约进度
- `message`: 普通消息 → 按需回复

消息格式：`[inbox type=<type> priority=<priority> from=<claw-id>]\n<body>`

### 4. 重启决策
触发重启的条件：
- Claw 明确报错停止
- 长时间无响应且催促无效
- 用户明确要求重启

重启前记录：
- 重启原因
- 当前状态
- 可能丢失的工作

## 自动化建议

心跳任务可通过定时任务（cron）或守护进程自动执行：
- 使用 `clawforum motion daemon` 启动守护模式
- 配置巡查间隔和触发条件
