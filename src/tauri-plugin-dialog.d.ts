declare module '@tauri-apps/plugin-dialog' {
  type OpenDialogOptions = {
    directory?: boolean
    multiple?: boolean
    title?: string
  }

  type ConfirmDialogOptions = {
    title?: string
    kind?: 'info' | 'warning' | 'error'
    okLabel?: string
    cancelLabel?: string
  }

  type SaveDialogOptions = {
    title?: string
    defaultPath?: string
    filters?: {
      name: string
      extensions: string[]
    }[]
  }

  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>

  export function save(options?: SaveDialogOptions): Promise<string | null>

  export function confirm(
    message: string,
    options?: string | ConfirmDialogOptions,
  ): Promise<boolean>
}
