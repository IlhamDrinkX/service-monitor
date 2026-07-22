/**
 * Stage 1 UI: SSH-ключ, snippet / apply config, профиль по серии.
 */

import { useEffect, useState } from "react";
import { ActionButton } from "../components/ActionButton";
import { localServiceUrls } from "@service-monitor/core";

export function AccessPage() {
  const [seriesLabel, setSeriesLabel] = useState("4.15");
  const [name, setName] = useState("Комплекс №4.15");
  const [pubkey, setPubkey] = useState("");
  const [snippet, setSnippet] = useState("");
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  const [paths, setPaths] = useState<{ identity: string; sshConfig: string }>({
    identity: "",
    sshConfig: "",
  });

  useEffect(() => {
    void (async () => {
      const p = await window.desktop.getPaths();
      setPaths({ identity: p.identityFile, sshConfig: p.sshConfig });
      const pub = await window.desktop.readPubkey();
      if (pub.ok) setPubkey(pub.pubkey);
    })();
  }, []);

  function show(text: string, error = false) {
    setToast({ text, error });
  }

  async function generateKey() {
    const res = await window.desktop.generateKey();
    if (!res.ok) {
      show(res.error, true);
      return;
    }
    setPubkey(res.pubkey);
    show("Ключ создан. Скопируйте pubkey и вставьте в ERP → SSH key.");
  }

  async function copyPubkey() {
    if (!pubkey) {
      show("Сначала создайте или найдите pubkey", true);
      return;
    }
    await navigator.clipboard.writeText(pubkey);
    show("Pubkey скопирован");
  }

  async function makeSnippet(includeJumpHost = false) {
    try {
      const res = await window.desktop.renderSnippet({
        seriesLabel,
        name,
        includeJumpHost,
      });
      setSnippet(res.snippet);
      show(
        includeJumpHost
          ? "Snippet: jump + комплекс"
          : "Snippet: только комплекс (без повторного erp.fibbee.com)"
      );
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), true);
    }
  }

  async function copySnippet() {
    try {
      const res = await window.desktop.renderSnippet({
        seriesLabel,
        name,
        includeJumpHost: false,
      });
      setSnippet(res.snippet);
      await navigator.clipboard.writeText(res.snippet);
      show("Скопирован только блок комплекса");
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), true);
    }
  }

  async function applyConfig() {
    try {
      const res = await window.desktop.applyConfig({ seriesLabel, name });
      const jumpNote = res.jumpHostAdded
        ? " (добавлен шлюз erp.fibbee.com — первый раз)"
        : res.hadJumpHost
          ? " (шлюз уже был — добавлен только комплекс)"
          : "";
      show(
        `Записано в ${res.path}${jumpNote}. Подключение: ssh ${(res.profile as { sshPort: number }).sshPort}`
      );
      await makeSnippet(false);
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), true);
    }
  }

  async function openConfig() {
    const res = await window.desktop.openSshConfig();
    if (!res.ok) {
      show(res.error, true);
      return;
    }
    show(`Открыт: ${res.path}`);
  }

  const urls = localServiceUrls();

  return (
    <div className="stack">
      <div className="panel">
        <h2>1. SSH-ключ для ERP</h2>
        <p className="lead">
          Один раз создайте ключ и добавьте публичную часть в ERP → Профиль →
          SSH key. Приватный ключ остаётся на этой машине.
        </p>
        <div className="row">
          <ActionButton
            helpId="access.generateKey"
            variant="primary"
            onClick={() => void generateKey()}
          >
            Создать ключ
          </ActionButton>
          <ActionButton
            helpId="access.copyPubkey"
            onClick={() => void copyPubkey()}
          >
            Копировать pubkey
          </ActionButton>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Файл: <code>{paths.identity || "…"}</code>
        </p>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Публичный ключ</label>
          <textarea
            readOnly
            value={pubkey || "Ключ ещё не найден — нажмите «Создать ключ»"}
          />
        </div>
      </div>

      <div className="panel">
        <h2>2. Профиль комплекса и ssh config</h2>
        <p className="lead">
          Новый комплекс дописывает только свой Host. Блок{" "}
          <code>erp.fibbee.com / User tun</code> добавляется один раз, если его
          ещё нет в файле.
        </p>
        <div className="row">
          <div className="field">
            <label htmlFor="series">Серия комплекса</label>
            <input
              id="series"
              value={seriesLabel}
              onChange={(e) => {
                setSeriesLabel(e.target.value);
                setName(`Комплекс №${e.target.value}`);
              }}
              placeholder="4.15"
            />
          </div>
          <div className="field">
            <label htmlFor="cname">Имя</label>
            <input
              id="cname"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <ActionButton
            helpId="access.copySnippet"
            onClick={() => void copySnippet()}
          >
            Копировать snippet
          </ActionButton>
          <ActionButton
            helpId="access.applyConfig"
            variant="primary"
            onClick={() => void applyConfig()}
          >
            Записать в ~/.ssh/config
          </ActionButton>
          <ActionButton
            helpId="access.openConfig"
            onClick={() => void openConfig()}
          >
            Открыть config
          </ActionButton>
          <ActionButton onClick={() => void makeSnippet(false)}>
            Показать
          </ActionButton>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Файл config: <code>{paths.sshConfig || "…"}</code>
        </p>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Snippet (только комплекс)</label>
          <textarea
            readOnly
            value={
              snippet || "Нажмите «Показать» или «Копировать snippet»"
            }
          />
        </div>
        <p className="muted">
          После туннеля: дашборд <code>{urls.dashboard}</code>, киоск{" "}
          <code>{urls.kiosk}</code>, графики milk/coffee/water — вкладка Сессия.
        </p>
      </div>

      {toast ? (
        <div className={`toast${toast.error ? " error" : ""}`}>{toast.text}</div>
      ) : null}
    </div>
  );
}
