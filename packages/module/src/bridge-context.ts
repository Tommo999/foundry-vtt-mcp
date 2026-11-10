/** Dependencies supplied by the GM bridge; handlers do not own authentication or session state. */
export interface BridgeContext {
  game: any;
  /** Current paired connection identity; read dynamically across awaits. */
  readonly sessionId?: string;
  resolve(uuid: string): Promise<any>;
  assertWrite(): void;
  serialize(document: any): any;
}
