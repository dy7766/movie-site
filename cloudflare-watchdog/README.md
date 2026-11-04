# 🛡️ 星光影库 · Cloudflare Worker 外部智能看门狗

本模块作为 GitHub Actions 自动化流水线的**外部看门狗（Watchdog）与保活中枢**，解决 GitHub 平台定时拥堵漏跑以及免费 Supabase 数据库休眠的问题。

---

## 🌟 核心能力
1. **防漏跑双保险**：每天在 **08:50 / 12:30 / 20:50**（比 GitHub Actions 定时延后 15 分钟）由 Cloudflare 全球边缘毫秒级准时巡检。
   - 若 GitHub 正常跑过了：**自动跳过**，绝不重复运行，不发重复消息；
   - 若 GitHub 平台漏跑了：**自动调用 API 强制拉起流水线**，并在钉钉通知管理员。
2. **Supabase 数据库永久保活**：定期自动 Ping PostgREST 接口，彻底避免 7 天无操作休眠。
3. **支持浏览器一键手动诊断**：访问 Worker 的公网 URL（例如 `https://movie-pipeline-watchdog.xxxx.workers.dev/`），即可原地查看最近运行状态并执行测试。

---

## 🚀 极简部署步骤（推荐通过 Cloudflare 控制台，1 分钟完成）

### 第一步：在 Cloudflare 创建 Worker
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)；
2. 点击左侧导航栏 **Workers 和 Pages** $\rightarrow$ **创建应用程序** $\rightarrow$ 选择 **Worker**；
3. 名称填写 `movie-pipeline-watchdog`，点击 **部署**；
4. 点击 **编辑代码**，将本目录下 [`src/index.js`](./src/index.js) 的完整代码直接**复制粘贴覆盖进去**，点击右上角 **保存并部署**。

---

### 第二步：配置定时触发器 (Cron Triggers)
在 Worker 管理页面：
1. 点击 **设置 (Settings)** $\rightarrow$ **触发器 (Triggers)** $\rightarrow$ **Cron 触发器 (Cron Triggers)**；
2. 添加以下 4 条 Cron 规则（直接点击“添加 Cron 触发器”粘贴即可）：
   - `50 0 * * *` （对应北京时间 08:50，晨间兜底）
   - `30 4 * * *` （对应北京时间 12:30，午间兜底）
   - `50 12 * * *` （对应北京时间 20:50，晚间兜底）
   - `0 3 * * 0` （每周日北京时间 11:00，Supabase 深度保活）

---

### 第三步：配置环境变量 (Variables & Secrets)
在 Worker 的 **设置 (Settings)** $\rightarrow$ **变量 (Variables)** 中添加：

| 变量名称 | 类型 | 示例值 / 获取途径 | 说明 |
| :--- | :--- | :--- | :--- |
| `GH_TOKEN` | **Encrypt (Secret)** | `ghp_xxxxxxxxxxxx` | 你的 GitHub Personal Access Token (需勾选 `actions:write` 与 `repo` 权限) |
| `REPO_OWNER` | 文本 (Plain text) | `dy7766` | GitHub 用户名 |
| `REPO_NAME` | 文本 (Plain text) | `movie-site` | 仓库名称 |
| `DINGTALK_WEBHOOK` | **Encrypt (Secret)** | `https://oapi.dingtalk.com/robot/send?access_token=...` | 钉钉群机器人 Webhook |
| `DINGTALK_SECRET` | **Encrypt (Secret)** | `SEC...` | 钉钉机器人安全设置中的加签密钥 |
| `DINGTALK_ALERT_PHONE`| 文本 (Plain text) | `15210865171` | 丁一手机号 |
| `SUPABASE_ANON_KEY` | **Encrypt (Secret)** | `eyJhbGciOi...` | Supabase 项目的 anon public key（用于数据库防休眠 Ping） |

---

## 🧪 测试与验收
部署完成后，直接在浏览器中打开 Worker 生成的域名（例如 `https://movie-pipeline-watchdog.your-subdomain.workers.dev/`）：
- 若最近刚跑过，页面会清晰输出：
  ```json
  {
    "action": "skipped",
    "reason": "上一棒在 12 分钟前已正常运行 (ID: 41777158822)，无需兜底"
  }
  ```
- 此时双保险即全面生效！
