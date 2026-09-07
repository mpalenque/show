/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare module '*?worker&url' {
  const url: string;
  export default url;
}
