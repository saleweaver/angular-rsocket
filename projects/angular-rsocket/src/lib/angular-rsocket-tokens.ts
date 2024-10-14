import { InjectionToken } from '@angular/core';
import { AngularRSocketConfig } from './angular-rsocket-config';
import {AngularRSocketTokenProvider} from './angular-rsocket-token-provider.interface';

export const ANGULAR_RSOCKET_CONFIG = new InjectionToken<AngularRSocketConfig>('RSocketConfig');
export const ANGULAR_RSOCKET_TOKEN_PROVIDER = new InjectionToken<AngularRSocketTokenProvider>('RSocketTokenProvider');
