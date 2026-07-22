/**
 * Stage 2 tests: Fibbee cloud client (mocked fetch — без сети).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FibbeeAuthError,
  FibbeeClient,
  normalizeSalesPoint,
} from "./cloud/fibbee-client.js";

describe("stage2 / normalizeSalesPoint", () => {
  it("reads ru name and status", () => {
    const p = normalizeSalesPoint({
      salesPointId: "sp-1",
      name: { ru: "Комплекс 4.15", en: "Complex" },
      status: "production",
      brand: "DrinkX",
      series: "4.15",
    });
    assert.equal(p.salesPointId, "sp-1");
    assert.equal(p.name, "Комплекс 4.15");
    assert.equal(p.status, "production");
    assert.equal(p.seriesLabel, "4.15");
  });
});

describe("stage2 / FibbeeClient", () => {
  it("logs in and stores token from /v1/auth/create", async () => {
    const calls: string[] = [];
    const client = new FibbeeClient({
      baseUrl: "https://erp.example",
      fetchImpl: async (input, init) => {
        calls.push(`${init?.method} ${String(input)}`);
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.email, "a@b.c");
        assert.equal(body.password, "secret");
        return new Response(
          JSON.stringify({
            success: true,
            token: "jwt-test",
            userId: 42,
            role: "admin",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    });

    const session = await client.login("a@b.c", "secret");
    assert.equal(session.token, "jwt-test");
    assert.equal(client.getToken(), "jwt-test");
    assert.ok(calls[0].includes("/v1/auth/create"));
  });

  it("rejects failed login", async () => {
    const client = new FibbeeClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: false, error: "bad" }), {
          status: 200,
        }),
    });
    await assert.rejects(
      () => client.login("x", "y"),
      (err: unknown) => err instanceof FibbeeAuthError
    );
  });

  it("lists sales points with x-auth-token header", async () => {
    const client = new FibbeeClient({
      baseUrl: "https://erp.example",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/auth/create")) {
          return json({ success: true, token: "tok" });
        }
        assert.equal(init?.method, "GET");
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers["x-auth-token"], "tok");
        assert.equal(headers["x-lang"], "ru");
        return json({
          success: true,
          salesPoints: [
            {
              salesPointId: "aaa",
              name: { ru: "Точка А" },
              status: "production",
            },
            {
              salesPointId: "bbb",
              name: { ru: "Точка Б" },
              status: "archived",
            },
          ],
        });
      },
    });

    await client.login("e", "p");
    const list = await client.listSalesPoints();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, "Точка А");
    assert.equal(list[1].status, "archived");
  });

  it("builds ERP dashboard URL with token", async () => {
    const client = new FibbeeClient({ baseUrl: "https://erp.fibbee.com" });
    client.setToken("abc.def");
    const url = client.buildDashboardUrl("sp%1");
    assert.ok(url.startsWith("https://erp.fibbee.com/dashboard/view/"));
    assert.match(url, /token=abc/);
  });
});

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
