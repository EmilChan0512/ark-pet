import { Application, Container } from 'pixi.js'

export class PixiRenderer {
  private app: Application | null = null
  private readonly root = new Container()
  private readonly onWindowResize = () => {
    if (!this.app) return
    this.app.renderer.resolution = window.devicePixelRatio || 1
    this.app.renderer.resize(window.innerWidth, window.innerHeight)
  }

  async init(host: HTMLElement) {
    try {
      const app = new Application({
        resizeTo: window,
        autoDensity: true,
        antialias: true,
        backgroundAlpha: 0,
        clearBeforeRender: true,
        resolution: window.devicePixelRatio || 1,
      })
      app.ticker.maxFPS = 60

      const view = app.view as HTMLCanvasElement
      view.style.width = '100%'
      view.style.height = '100%'
      view.style.display = 'block'
      view.style.background = 'transparent'
      host.appendChild(view)

      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen
      app.stage.addChild(this.root)

      this.app = app
      window.addEventListener('resize', this.onWindowResize)

      return app
    } catch (error) {
      throw new Error(
        `WebGL initialization error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  getApplication() {
    if (!this.app) {
      throw new Error('PixiRenderer has not been initialized')
    }
    return this.app
  }

  getRoot() {
    return this.root
  }

  resize() {
    this.onWindowResize()
  }

  pauseTicker() {
    this.app?.ticker.stop()
  }

  resumeTicker() {
    this.app?.ticker.start()
  }

  removeTickerCallback(callback: () => void) {
    this.app?.ticker.remove(callback)
  }

  destroy() {
    window.removeEventListener('resize', this.onWindowResize)

    if (this.app) {
      this.root.removeFromParent()
      this.root.destroy({ children: true })
      this.app.destroy(true, { children: true, texture: true, baseTexture: false })
      this.app = null
    }
  }
}
