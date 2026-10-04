/// <reference types="vite/client" />

// guide.css をインライン文字列として取り込むための型定義。
declare module '*.css?inline' {
  const css: string;
  export default css;
}
