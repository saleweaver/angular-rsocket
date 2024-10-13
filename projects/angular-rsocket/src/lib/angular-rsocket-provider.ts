import { CommonModule } from '@angular/common';
import {EnvironmentProviders, makeEnvironmentProviders} from '@angular/core';
import { ANGULAR_RSOCKET_CONFIG } from './angular-rsocket-tokens';
import { AngularRSocketConfig } from './angular-rsocket-config';
import {RSocketService} from './angular-rsocket.service';

export function provideRSocket(config: AngularRSocketConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    CommonModule,
    RSocketService,
    {
      provide: ANGULAR_RSOCKET_CONFIG,
      useValue: config,
    },
  ]);
}
