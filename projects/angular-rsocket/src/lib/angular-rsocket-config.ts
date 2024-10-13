import {Serializer, WellKnownMimeType} from 'rsocket-core';
import {Signal} from '@angular/core';

export interface AngularRSocketConfig {
  /**
   * The WebSocket URL for the RSocket server.
   * Example: 'ws://localhost:8080/rsocket'
   */
  url: string;

  /**
   * Optional serializers for data.
   * Default: IdentitySerializer
   */
  dataSerializer?: Serializer<any>;

  /**
   * Optional serializers for metadata.
   * Default: IdentitySerializer
   */
  metadataSerializer?: Serializer<any>;

  /**
   * The interval (in milliseconds) for sending keep-alive frames.
   * Default: 60000 (60 seconds)
   */
  keepAlive?: number;

  /**
   * The maximum lifetime (in milliseconds) for the connection.
   * Default: 180000 (3 minutes)
   */
  lifetime?: number;

  /**
   * The MIME type for data payloads.
   * Default: APPLICATION_JSON
   */
  dataMimeType?: WellKnownMimeType;

  /**
   * The MIME type for metadata payloads.
   * Default: MESSAGE_RSOCKET_COMPOSITE_METADATA
   */
  metadataMimeType?: WellKnownMimeType;

  /**
   * The maximum number of reconnection attempts.
   * Default: 5
   */
  maxReconnectAttempts?: number;

  /**
   * The delay (in milliseconds) between reconnection attempts.
   * Default: 2000 (2 seconds)
   */
  reconnectDelay?: number;

  /**
   * Optional JWT token for authentication.
   * If provided, authentication metadata will be included in requests.
   */
  token?: string | Signal<string> | (() => string | Signal<string>);
}
