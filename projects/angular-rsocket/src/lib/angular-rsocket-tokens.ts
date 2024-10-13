import { InjectionToken } from '@angular/core';
import { AngularRSocketConfig } from './angular-rsocket-config';

export const ANGULAR_RSOCKET_CONFIG = new InjectionToken<AngularRSocketConfig>('RSocketConfig');
