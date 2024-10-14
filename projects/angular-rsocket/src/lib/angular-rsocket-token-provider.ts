// default-token-provider.ts
import { Injectable, Inject } from '@angular/core';
import { ANGULAR_RSOCKET_CONFIG } from './angular-rsocket-tokens';
import { AngularRSocketConfig } from './angular-rsocket-config';
import {AngularRSocketTokenProvider} from './angular-rsocket-token-provider.interface';

@Injectable({
  providedIn: 'root',
})
export class DefaultTokenProvider implements AngularRSocketTokenProvider {
  constructor(@Inject(ANGULAR_RSOCKET_CONFIG) private config: AngularRSocketConfig) {}

  getToken(): string | null {
    return this.config.token || null;
  }
}
