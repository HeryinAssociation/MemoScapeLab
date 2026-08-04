/**
 * 本地开发启动器：清除代理环境变量后启动 vinext dev。
 *
 * 背景：workerd（Miniflare）的 outbound fetch 会读取 HTTPS_PROXY/HTTP_PROXY
 * 环境变量，而本机经 127.0.0.1:7897 代理的 TLS 握手会卡死后台图片生成任务
 * （火山方舟直连正常，之前多次任务挂在 running 直到 10 分钟回收）。
 * 生产环境（Cloudflare 部署）无此代理，不受影响。
 */
import { spawn } from "node:child_process";

// 清除所有代理相关环境变量（大小写全清，包括 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY 及其小写形式），
// 避免 workerd（Miniflare）的后台 fetch 经本机代理（如 127.0.0.1:7897 / 1080）卡死 TLS 握手。
const cleared = [];
for (const name of Object.keys(process.env)) {
  if (/proxy/i.test(name)) {
    delete process.env[name];
    cleared.push(name);
  }
}
if (cleared.length > 0) {
  console.log(`[dev] 已清除本地代理环境变量（${cleared.join(", ")}），避免后台 fetch 卡死。`);
}

// Windows 上 .cmd 必须经 shell 启动（直接 spawn pnpm.cmd 会抛 EINVAL）
const child = spawn(
  process.platform === "win32" ? "pnpm" : "pnpm",
  ["exec", "vinext", "dev"],
  { stdio: "inherit", env: process.env, shell: process.platform === "win32" },
);

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});
child.on("error", (error) => {
  console.error("[dev] 启动失败：", error.message);
  process.exit(1);
});
