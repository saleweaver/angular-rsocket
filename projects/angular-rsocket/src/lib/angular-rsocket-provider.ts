import {EnvironmentProviders, makeEnvironmentProviders, Type} from '@angular/core';
import {ANGULAR_RSOCKET_CONFIG, ANGULAR_RSOCKET_TOKEN_PROVIDER} from './angular-rsocket-tokens';
import {AngularRSocketConfig} from './angular-rsocket-config';
import {RSocketService} from './angular-rsocket.service';
import {AngularRSocketTokenProvider} from './angular-rsocket-token-provider.interface';
import {DefaultTokenProvider} from './angular-rsocket-token-provider';

export function provideRSocket(
  config: AngularRSocketConfig,
  tokenProvider?: Type<AngularRSocketTokenProvider>
): EnvironmentProviders {
  const providers: any[] = [
    RSocketService,
    {
      provide: ANGULAR_RSOCKET_CONFIG,
      useValue: config,
    },
    {
      provide: ANGULAR_RSOCKET_TOKEN_PROVIDER,
      useClass: tokenProvider ?? DefaultTokenProvider,
    }
  ];

  return makeEnvironmentProviders(providers);
}
