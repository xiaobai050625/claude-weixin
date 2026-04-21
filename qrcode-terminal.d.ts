declare module "qrcode-terminal" {
  interface GenerateOptions {
    small?: boolean;
  }

  const qrcodeTerminal: {
    generate(input: string, options: GenerateOptions, callback: (output: string) => void): void;
  };

  export default qrcodeTerminal;
}
