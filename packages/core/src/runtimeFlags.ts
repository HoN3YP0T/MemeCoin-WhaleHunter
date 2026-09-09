/** Shared mutable runtime state that Telegram /pause /resume /kill act on.
 * Deliberately a plain in-process object - it is read by the execution
 * pipeline's risk gate and written only by the telegram-bot commands. */
export class RuntimeFlags {
  private _paused = false;
  private _killed = false;

  get paused(): boolean {
    return this._paused;
  }

  get killed(): boolean {
    return this._killed;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    // Resuming does not clear a kill switch - kill is one-way for a session.
  }

  kill(): void {
    this._killed = true;
    this._paused = true;
  }

  tradingAllowed(): boolean {
    return !this._paused && !this._killed;
  }
}
