
import { IdentitySerializer, APPLICATION_JSON, MESSAGE_RSOCKET_COMPOSITE_METADATA  } from 'rsocket-core';
import { AngularRSocketConfig } from './angular-rsocket-config';

export const DEFAULT_ANGULAR_RSOCKET_CONFIG: Partial<AngularRSocketConfig> = {
  dataSerializer: IdentitySerializer,
  metadataSerializer: IdentitySerializer,
  keepAlive: 60000, // 60 seconds
  lifetime: 180000,  // 3 minutes
  dataMimeType: APPLICATION_JSON,
  metadataMimeType: MESSAGE_RSOCKET_COMPOSITE_METADATA,
  maxReconnectAttempts: 5,
  reconnectDelay: 2000, // 2 seconds
};
