/** Dependencies supplied by the GM bridge; handlers do not own authentication or session state. */
export interface BridgeContext {
  game: any;
  resolve(uuid: string): Promise<any>;
  assertWrite(): void;
  serialize(document: any): any;
}
