import {Inject, Injectable, signal, Signal, WritableSignal} from '@angular/core';
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
import RSocketWebSocketClient from 'rsocket-websocket-client';
import {ANGULAR_RSOCKET_CONFIG} from './angular-rsocket-tokens';
import {type AngularRSocketConfig} from './angular-rsocket-config';
import {DEFAULT_ANGULAR_RSOCKET_CONFIG} from './default-angular-rsocket-config';
import {BehaviorSubject, Observable} from 'rxjs';

@Injectable()
export class RSocketService {
  // Signal to track connection status
  private _isConnected: BehaviorSubject<boolean> = new BehaviorSubject(false);
  public readonly isConnected: Observable<boolean> = this._isConnected.asObservable();

  // RSocket client and socket instances
  private client?: RSocketClient<any, any>;
  private socket: any; // Replace 'any' with the appropriate type if available

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
        this.socket = socket;
        this._isConnected.next(true);
        this.reconnectAttempts = 0;
        console.log('Connected to RSocket server');
      },
      onError: (error: any) => {
        console.error('Connection error:', error);
        this._isConnected.next(false);
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

    if (this.socket) {
      interactionFn(payload).subscribe({
        onComplete: () => {
          console.log('Interaction completed');
        },
        onError: (error: any) => {
          console.error(`Interaction error: ${error}`);
        },
        onNext: (payload: any) => {
          console.log(payload);
          this.handleResponse<T>(payload, dataSignal);
        },
        onSubscribe: (subscription: any) => {
          subscription.request(requestItems);
        },
      });
    }

    return dataSignal;
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
      (payload) => this.socket.requestStream(payload),
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
      (payload) => this.socket.requestResponse(payload),
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
      (payload) => this.socket.channel(payload),
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
      this.socket.fireAndForget(payload);
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
      this.socket.dispose();
      this._isConnected.next(false);
      console.debug('Disconnected from RSocket server');
    }
  }

  /**
   * Cleanup on service destruction.
   */
  ngOnDestroy(): void {
    this.disconnect();
    this._isConnected.next(false);
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

    if (this.config!.dataSerializer === IdentitySerializer) {
      try {
        const jsonString: string = payload.data.toString(); // Convert Buffer to string
        parsedData = JSON.parse(jsonString); // Parse string to JSON
      } catch (err) {
        console.error('Error parsing JSON:', err);
        return;
      }

    } else {
      parsedData = payload.data;
    }

    if (Array.isArray(parsedData)) {
      dataSignal.set([...parsedData]); // Update the signal with a new array reference
    } else {
      dataSignal.set(parsedData);
    }
  }
}
