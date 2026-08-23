declare module 'swiftbrowse' {
  export function browse(
    url: string,
    opts?: {
      mode?: 'headless' | 'headed' | 'hybrid'
      cookies?: boolean
      consent?: boolean
      prune?: boolean
      pruneMode?: 'act' | 'read'
      timeout?: number
      viewport?: string
    }
  ): Promise<string>
}
