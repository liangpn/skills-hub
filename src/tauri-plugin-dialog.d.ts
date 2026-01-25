declare module '@tauri-apps/plugin-dialog' {
  type OpenDialogOptions = {
    directory?: boolean
    multiple?: boolean
    title?: string
  }

  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>
}
