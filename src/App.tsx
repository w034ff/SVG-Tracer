import type { ReactElement } from "react";
import { translations } from "./i18n";
import "./styles/tokens.css";

export function App(): ReactElement {
  return (
    <main>
      <h1>{translations.ja.appTitle}</h1>
    </main>
  );
}
