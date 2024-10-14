import {effect, Inject, Injectable, signal, Signal, WritableSignal} from '@angular/core';
import {
  BufferEncoders,
  encodeBearerAuthMetadata,
  encodeCompositeMetadata,
  encodeRoute,
  IdentitySerializer,
  MESSAGE_RSOCKET_AUTHENTICATION,
  MESSAGE_RSOCKET_ROUTING,
  RSocketClient,
  WellKnownMimeType
} from 'rsocket-core';
import {ANGULAR_RSOCKET_CONFIG} from './angular-rsocket-tokens';
import {type AngularRSocketConfig} from './angular-rsocket-config';
import {DEFAULT_ANGULAR_RSOCKET_CONFIG} from './default-angular-rsocket-config';
import {BehaviorSubject, Observable} from 'rxjs';


import type {
  DuplexConnection,
  Frame,
  ISubject,
  ISubscriber,
  ISubscription,
} from 'rsocket-types';
import type { Encoders } from 'rsocket-core';

import { Flowable } from 'rsocket-flowable';
import {
  deserializeFrame,
  deserializeFrameWithLength,
  printFrame,
  serializeFrame,
  serializeFrameWithLength,
  toBuffer,
} from 'rsocket-core';
/**
 * Connection status types representing the various states of the connection.
 */
export type ConnectionStatus =
  | { kind: "NOT_CONNECTED" }
  | { kind: "CONNECTING" }
  | { kind: "CONNECTED" }
  | { kind: "CLOSED" }
  | { kind: "ERROR"; error: Error };

/**
 * Constants representing each non-error connection status.
 */
export const CONNECTION_STATUS = {
  NOT_CONNECTED: { kind: "NOT_CONNECTED" } as ConnectionStatus,
  CONNECTING: { kind: "CONNECTING" } as ConnectionStatus,
  CONNECTED: { kind: "CONNECTED" } as ConnectionStatus,
  CLOSED: { kind: "CLOSED" } as ConnectionStatus,
} as const;

export type ClientOptions = {
  url: string;
  wsCreator?: (url: string) => WebSocket;
  debug?: boolean;
  lengthPrefixedFrames?: boolean;
};

/**
 * A WebSocket transport client for use in browser environments.
 */
export default class RSocketWebSocketClient implements DuplexConnection {
  private _encoders?: Encoders<any>;
  private _options: ClientOptions;
  private _receivers: Set<ISubscriber<Frame>>;
  private _senders: Set<ISubscription>;
  private _socket?: WebSocket;
  private _status: ConnectionStatus;
  private _statusSubscribers: Set<ISubject<ConnectionStatus>>;

  constructor(options: ClientOptions, encoders?: Encoders<any>) {
    this._encoders = encoders;
    this._options = options;
    this._receivers = new Set();
    this._senders = new Set();
    this._socket = undefined;
    this._status = CONNECTION_STATUS.NOT_CONNECTED;
    this._statusSubscribers = new Set();
  }

  close(): void {
    this._close();
  }

  connect(): void {
    if (this._status.kind !== 'NOT_CONNECTED') {
      throw new Error(
        'RSocketWebSocketClient: Cannot connect(), a connection is already established.',
      );
    }
    this._setConnectionStatus(CONNECTION_STATUS.CONNECTING);

    const wsCreator = this._options.wsCreator;
    const url = this._options.url;
    this._socket = wsCreator ? wsCreator(url) : new WebSocket(url);

    if (!this._socket) {
      throw new Error('RSocketWebSocketClient: Failed to create WebSocket.');
    }

    const socket = this._socket;
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('close', this._handleClosed);
    socket.addEventListener('error', this._handleError);
    socket.addEventListener('open', this._handleOpened);
    socket.addEventListener('message', this._handleMessage);
  }

  connectionStatus(): Flowable<ConnectionStatus> {
    return new Flowable((subscriber) => {
      subscriber.onSubscribe({
        cancel: () => {
          this._statusSubscribers.delete(subscriber);
        },
        request: () => {
          this._statusSubscribers.add(subscriber);
          subscriber.onNext(this._status);
        },
      });
    });
  }

  receive(): Flowable<Frame> {
    return new Flowable((subject) => {
      subject.onSubscribe({
        cancel: () => {
          this._receivers.delete(subject);
        },
        request: () => {
          this._receivers.add(subject);
        },
      });
    });
  }

  sendOne(frame: Frame): void {
    this._writeFrame(frame);
  }

  send(frames: Flowable<Frame>): void {
    let subscription: ISubscription | undefined;
    frames.subscribe({
      onComplete: () => {
        if (subscription) {
          this._senders.delete(subscription);
        }
      },
      onError: (error) => {
        if (subscription) {
          this._senders.delete(subscription);
        }
        this._close(error);
      },
      onNext: (frame) => this._writeFrame(frame),
      onSubscribe: (_subscription) => {
        subscription = _subscription;
        this._senders.add(subscription);
        subscription.request(Number.MAX_SAFE_INTEGER);
      },
    });
  }

  private _close(error?: Error): void {
    if (this._status.kind === 'CLOSED' || this._status.kind === 'ERROR') {
      // already closed
      return;
    }
    const status: ConnectionStatus = error
      ? { error, kind: 'ERROR' }
      : CONNECTION_STATUS.CLOSED;
    this._setConnectionStatus(status);
    this._receivers.forEach((subscriber) => {
      if (error) {
        subscriber.onError(error);
      } else {
        subscriber.onComplete();
      }
    });
    this._receivers.clear();
    this._senders.forEach((subscription) => subscription.cancel());
    this._senders.clear();
    const socket = this._socket;
    if (socket) {
      socket.removeEventListener('close', this._handleClosed);
      socket.removeEventListener('error', this._handleError);
      socket.removeEventListener('open', this._handleOpened);
      socket.removeEventListener('message', this._handleMessage);
      socket.close();
      this._socket = undefined;
    }
  }

  private _setConnectionStatus(status: ConnectionStatus): void {
    this._status = status;
    this._statusSubscribers.forEach((subscriber) => subscriber.onNext(status));
  }

  private _handleClosed = (event: CloseEvent): void => {
    this._close(
      new Error(
        event.reason || 'RSocketWebSocketClient: Socket closed unexpectedly.',
      ),
    );
  };

  private _handleError = (event: Event): void => {
    this._close(new Error('RSocketWebSocketClient: WebSocket encountered an error.'));
  };

  private _handleOpened = (): void => {
    this._setConnectionStatus(CONNECTION_STATUS.CONNECTED);
  };

  private _handleMessage = (message: MessageEvent): void => {
    try {
      const frame = this._readFrame(message);
      this._receivers.forEach((subscriber) => subscriber.onNext(frame));
    } catch (error) {
      this._close(error instanceof Error ? error : new Error(String(error)));
    }
  };

  private _readFrame(message: MessageEvent): Frame {
    const buffer = toBuffer(message.data);
    const frame = this._options.lengthPrefixedFrames
      ? deserializeFrameWithLength(buffer, this._encoders)
      : deserializeFrame(buffer, this._encoders);


    return frame;
  }

  private _writeFrame(frame: Frame): void {
    try {

      const buffer = this._options.lengthPrefixedFrames
        ? serializeFrameWithLength(frame, this._encoders)
        : serializeFrame(frame, this._encoders);
      if (!this._socket) {
        throw new Error(
          'RSocketWebSocketClient: Cannot send frame, not connected.',
        );
      }
      this._socket.send(buffer);
    } catch (error) {
      this._close(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

@Injectable()
export class RSocketService {
  // Signal to track connection status
  private _isConnected: WritableSignal<boolean> = signal(false);
  public readonly isConnected: Signal<boolean> = this._isConnected.asReadonly();

  // RSocket client and socket instances
  private client?: RSocketClient<any, any>;
  private socket = signal<any>(null);
  private pendingInteractions: Array<() => void> = [];
  private subscriptions: Set<any> = new Set();

  // Reconnection parameters
  private reconnectAttempts = 0;

  private maxReconnectAttempts: number;
  private reconnectDelay: number; // milliseconds

  // Configuration
  private config: AngularRSocketConfig;

  constructor(@Inject(ANGULAR_RSOCKET_CONFIG) private userConfig: AngularRSocketConfig) {

    // Merge user configuration with default configuration
    this.config = {...DEFAULT_ANGULAR_RSOCKET_CONFIG, ...this.userConfig};

    // Set reconnection parameters with defaults
    this.maxReconnectAttempts = this.config.maxReconnectAttempts ?? 5;
    this.reconnectDelay = this.config.reconnectDelay ?? 2000;

    // Initialize the client with provided serializers and MIME types
    this.initializeClient();

    effect(() => {
      const socket = this.socket();
      if (socket) {
        // Process pending interactions
        this.pendingInteractions.forEach(fn => fn());
        this.pendingInteractions = [];
      }
    });
  }

  public getInstance(): RSocketClient<any, any> | undefined {
    return this.client;
  }
  /**
   * Initialize the RSocket client and establish connection.
   */
  private initializeClient(): void {
    this.client = new RSocketClient({
      serializers: {
        data: this.config!.dataSerializer!,
        metadata: this.config!.metadataSerializer!,
      },
      setup: {
        keepAlive: this.config!.keepAlive!,
        lifetime: this.config!.lifetime!,
        dataMimeType: this.config!.dataMimeType!.string,
        metadataMimeType: this.config!.metadataMimeType!.string,
        payload: this.getSetupPayload(),
      },
      transport: new RSocketWebSocketClient(
        {
          url: this.config.url,
        },
        BufferEncoders
      ),
    });

    this.connect();
  }

  /**
   * Helper method to resolve the setup payload, including authentication if a token is provided.
   * @returns The setup payload with or without authentication metadata.
   */
  private getSetupPayload(): any {
    const metadataPairs: [WellKnownMimeType, Buffer][] = [];

    // If a token is provided, include it in the setup payload
    if (this.config!.token) {
      const token = this.resolveProvidedToken(this.config!.token);
      if (token) {
        metadataPairs.push([MESSAGE_RSOCKET_AUTHENTICATION, encodeBearerAuthMetadata(token)]);
      }
    }

    const compositeMetadata = encodeCompositeMetadata(metadataPairs);

    return {
      metadata: compositeMetadata,
    };
  }

  /**
   * Establish connection to the RSocket server.
   */
  private connect(): void {
    this.client!.connect().subscribe({
      onComplete: (socket: any) => {
        this.socket.set(socket);
        this._isConnected.set(true);
        this.reconnectAttempts = 0;
        console.log('Connected to RSocket server');
      },
      onError: (error: any) => {
        console.error('Connection error:', error);
        this._isConnected.set(false);
        this.socket.set(null);
        this.cleanupSubscriptions(); // Cancel active subscriptions

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(
            `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
          );
          setTimeout(() => this.connect(), this.reconnectDelay);
        } else {
          console.error('Max reconnection attempts reached');
        }
      },
      onSubscribe: () => {
        // Handle subscription if needed
      },
    });
  }

  /**
   * Generic method to handle RSocket interactions and reduce duplication.
   * @param interactionFn The RSocket interaction function to invoke (e.g., requestStream, requestResponse).
   * @param route The RSocket route to interact with.
   * @param data The data payload to send.
   * @param requestItems The number of items to request (relevant for streams).
   * @param token Optional JWT token for authentication.
   * @returns A WritableSignal that updates with incoming data.
   */
  private performInteraction<T>(
    interactionFn: (payload: any) => any,
    route: string,
    data: any,
    requestItems: number,
    token?: string | Signal<string> | (() => string | Signal<string>)
  ): WritableSignal<T[] | T | null> {
    const dataSignal: WritableSignal<T[] | T | null> = signal(
      Array.isArray(data) ? [] : null
    );
    const compositeMetadata = this.getCompositeMetadata(token, route);

    const payload = {
      data: this.config!.dataSerializer
        ? this.config!.dataSerializer.serialize(data)
        : data,
      metadata: compositeMetadata,
    };

    const executeInteraction = () => {
      const subscription = interactionFn(payload).subscribe({
        onComplete: () => {
          console.log('Interaction completed');
          this.subscriptions.delete(subscription); // Remove from subscriptions
        },
        onError: (error: any) => {
          console.error(`Interaction error: ${error}`);
          this.subscriptions.delete(subscription); // Remove from subscriptions
        },
        onNext: (payload: any) => {
          this.handleResponse<T>(payload, dataSignal);
        },
        onSubscribe: (subscription: any) => {
          subscription.request(requestItems);
        },
      });
      this.subscriptions.add(subscription);
    };

    if (this.socket()) {
      executeInteraction();
    } else {
      // Queue the interaction to be executed when the socket is connected
      this.pendingInteractions.push(executeInteraction);
    }

    return dataSignal;
  }

  private cleanupSubscriptions(): void {
    this.subscriptions.forEach((subscription) => {
      if (subscription.cancel) {
        subscription.cancel();
      }
    });
    this.subscriptions.clear();
  }

  private getCompositeMetadata(token: string | Signal<string> | (() => (string | Signal<string>)) | undefined, route: string) {
    const resolvedToken = this.resolveProvidedToken(token);

    const metadataPairs: [WellKnownMimeType, Buffer][] = [
      [MESSAGE_RSOCKET_ROUTING, encodeRoute(route)],
    ];

    if (resolvedToken) {
      metadataPairs.push([
        MESSAGE_RSOCKET_AUTHENTICATION,
        encodeBearerAuthMetadata(resolvedToken),
      ]);
    }

    return encodeCompositeMetadata(metadataPairs);
  }

  /**
   * Send a request stream to a specific route.
   * @param route The RSocket route to interact with.
   * @param data Optional data payload.
   * @param requestItems The number of items to request (default: Number.MAX_SAFE_INTEGER).
   * @param token Optional JWT token for authentication.
   * @returns A signal that updates with incoming data.
   */
  public requestStream<T>(
    route: string,
    data: any = null,
    requestItems: number = Number.MAX_SAFE_INTEGER,
    token?: string | Signal<string> | (() => string | Signal<string>)
  ): WritableSignal<T[] | null> {
    return this.performInteraction<T>(
      (payload) => this.socket().requestStream(payload),
      route,
      data,
      requestItems,
      token
    ) as WritableSignal<T[] | null>;
  }

  /**
   * Send a request-response to a specific route.
   * @param route The RSocket route to interact with.
   * @param data Data payload.
   * @param token Optional JWT token for authentication.
   * @returns A signal that updates with the response data.
   */
  public requestResponse<T>(
    route: string,
    data: any,
    token?: string | Signal<string> | (() => string | Signal<string>)
  ): WritableSignal<T | null> {
    return this.performInteraction<T>(
      (payload) => this.socket().requestResponse(payload),
      route,
      data,
      1, // For requestResponse, request only 1 item
      token
    ) as WritableSignal<T | null>;
  }

  /**
   * Send a channel (bidirectional stream) to a specific route.
   * @param route The RSocket route to interact with.
   * @param dataIterable An iterable of data to send.
   * @param requestItems The number of items to request.
   * @param token Optional JWT token for authentication.
   * @returns A signal that updates with incoming data from the server.
   */
  public channel<T>(
    route: string,
    dataIterable: Iterable<any>,
    requestItems: number = Number.MAX_SAFE_INTEGER,
    token?: string | Signal<string> | (() => string | Signal<string>)
  ): WritableSignal<T | null> {
    const data = Array.from(dataIterable); // Convert iterable to array
    return this.performInteraction<T>(
      (payload) => this.socket().channel(payload),
      route,
      data,
      requestItems,
      token
    ) as WritableSignal<T | null>;
  }

  /**
   * Send a fire-and-forget message to a specific route.
   * @param route The RSocket route to interact with.
   * @param data Data payload.
   * @param token Optional JWT token for authentication.
   */
  public fireAndForget(
    route: string,
    data: any,
    token?: string | Signal<string> | (() => string | Signal<string>)
  ): void {
    const compositeMetadata = this.getCompositeMetadata(token, route);

    const payload = {
      data: data,
      metadata: compositeMetadata,
    };

    if (this.socket) {
      this.socket().fireAndForget(payload);
      console.debug(`Fire-and-forget sent to route: ${route}`);
    } else {
      throw Error('RSocket connection is not established');
    }
  }

  /**
   * Disconnect the RSocket client.
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket().dispose();
      this._isConnected.set(false);
      console.debug('Disconnected from RSocket server');
    }
  }

  /**
   * Cleanup on service destruction.
   */
  ngOnDestroy(): void {
    this.disconnect();
    this._isConnected.set(false);
    this.cleanupSubscriptions(); // Cancel active subscriptions
  }

  /**
   * Helper method to resolve the token provided in method calls.
   * It handles token provided as string, Signal<string>, or a function returning one of these.
   * @param token The token to resolve.
   * @returns The resolved JWT token or null.
   */
  private resolveProvidedToken(token?: string | Signal<string> | (() => string | Signal<string>)): string | null {
    if (!token) return null;

    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'function') {
      const result = token();
      if (typeof result === 'string') {
        return result;
      }
      if (typeof result === 'function') { // Signal<string>
        return result();
      }
    }

    // If token is a Signal<string>
    if (typeof token === 'object' && 'subscribe' in token) { // Signals are functions
      return (token as Signal<string>)();
    }

    return null;
  }

  private isBinaryData(data: any): boolean {
    return (
      (typeof Buffer !== 'undefined' && data instanceof Buffer) ||
      data instanceof Uint8Array ||
      data instanceof ArrayBuffer
    );
  }

  private decodeBinaryData(data: Uint8Array | Buffer | ArrayBuffer): string {
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(data));
    } else if (data instanceof Uint8Array) {
      return new TextDecoder().decode(data);
    }  else {
      console.error('DataType:', typeof data);
      throw new Error('Unsupported binary data type');
    }
  }

  /**
   * Handle the incoming payload and update the corresponding signal.
   * @param payload The incoming payload from RSocket.
   * @param dataSignal The signal to update with parsed data.
   */
  private handleResponse<T>(
    payload: { data: any },
    dataSignal: WritableSignal<T[] | T | null>
  ): void {
    let parsedData: T;

    if (this.isBinaryData(payload.data)) {
      try {
        // Decode binary data to string
        const jsonString: string = this.decodeBinaryData(payload.data);
        // Parse JSON string to object
        parsedData = JSON.parse(jsonString);
      } catch (err) {
        console.error('Error parsing JSON:', err);
        return;
      }
    } else {
      // Assume data is already parsed
      parsedData = payload.data;
    }

    if (Array.isArray(parsedData)) {
      dataSignal.set([...parsedData]); // Update the signal with a new array reference
    } else {
      dataSignal.set(parsedData);
    }
  }
}

