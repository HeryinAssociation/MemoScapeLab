import assert from "node:assert/strict";
import test from "node:test";

function mockDatabase() {
  return {
    prepare(query) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (/SELECT id FROM users WHERE role = 'superadmin'/i.test(query)) return { id: "admin-test" };
          if (/FROM sessions s/i.test(query)) return {
            id: "admin-test", username: "superadmin", email: "admin@example.test",
            email_verified: 1, phone_e164: null, phone_verified: 0,
            password_hash: "unused", avatar_key: null, role: "superadmin", status: "active",
            must_change_password: 0, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
            banned_at: null, csrf_token: "csrf-test", expires_at: new Date(Date.now() + 60_000).toISOString(),
          };
          return null;
        },
        async all() {
          if (/PRAGMA table_info\(projects\)/i.test(query)) return { results: [{ name: "owner_user_id" }] };
          return { results: [] };
        },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
}

async function render(path = "/", authenticated = true) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html", ...(authenticated ? { cookie: "ap_session=test-session" } : {}) },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      DB: mockDatabase(),
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the project database as the primary admin application", async () => {
  const response = await render("/proj");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
  assert.match(html, /<title>MemoscapeLab｜影像项目管理工作台<\/title>/i);
  assert.match(html, /MemoscapeLab/);
  assert.match(html, /影像项目/);
  assert.match(html, /新建照片项目/);
  assert.match(html, /项目档案/);
  assert.match(html, /<small>生成<\/small>/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("redirects anonymous visitors to login", async () => {
  const response = await render("/", false);
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).pathname, "/login");
});

test("renders the login and registration entry points", async () => {
  const login = await render("/login", false);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /欢迎回来|用户登录/);
  const registration = await render("/reg", false);
  assert.equal(registration.status, 200);
  assert.match(await registration.text(), /建立账号|用户注册/);
});

test("renders the MemoscapeLab about page without team credits", async () => {
  const response = await render("/about");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /MemoscapeLab/);
  assert.match(html, /记忆空间实验室/);
  assert.match(html, /第十一届上海图书馆开放数据竞赛作品/);
  assert.doesNotMatch(html, /指导教师|团队领队|技术研发|艺术设计|UI设计|测试调优/);
  assert.doesNotMatch(html, /付雅明|王凤羽|郑晓优|赵朔辰|曾泽川|王宝笛|徐蒙|张妍|孟俊树/);
  assert.match(html, /2026年8月10日更新/);
});

test("ships the local Pannellum runtime and stylesheet", async () => {
  const html = await (await render("/proj")).text();
  assert.match(html, /\/vendor\/pannellum\/pannellum\.css/);
  assert.match(html, /\/vendor\/pannellum\/pannellum\.js/);
  assert.match(html, /\/og-editor\.png/);
});

test("provides the four-step project workbench", async () => {
  const response = await render("/work");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /上传照片/);
  assert.match(html, /生成全景/);
  assert.match(html, /投影调参/);
  assert.match(html, /发布/);
  assert.match(html, /影像元数据/);
  assert.match(html, /WEBP 缩略图/);
  assert.match(html, /最大 10 MB/);
  assert.match(html, /最大 50 MB/);
});

test("keeps publish preview inside the workbench instead of a separate viewer route", async () => {
  const response = await render("/viewer?id=bund-clocktower-1930");
  assert.equal(response.status, 404);
});
