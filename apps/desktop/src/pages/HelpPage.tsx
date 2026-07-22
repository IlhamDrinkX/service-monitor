/**
 * Раздел Help: подробные статьи о софте и комплексе.
 */

import { useState } from "react";
import { HELP_ARTICLES } from "@service-monitor/core";

export function HelpPage() {
  const [activeId, setActiveId] = useState(HELP_ARTICLES[0]?.id ?? "");
  const article = HELP_ARTICLES.find((a) => a.id === activeId) ?? HELP_ARTICLES[0];

  return (
    <div className="grid-2">
      <div className="panel">
        <h2>Разделы справки</h2>
        <p className="lead">Коротко о приложении и о том, как устроен комплекс.</p>
        <div className="article-nav">
          {HELP_ARTICLES.map((a) => (
            <button
              key={a.id}
              type="button"
              className={a.id === article?.id ? "active" : ""}
              onClick={() => setActiveId(a.id)}
            >
              {a.title}
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>{article?.title}</h2>
        <div className="article">{article?.body}</div>
      </div>
    </div>
  );
}
