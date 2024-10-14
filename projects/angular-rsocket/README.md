Angular RSocket Service
------------------------

An Angular service for integrating RSocket communication into your Angular applications, leveraging Angular’s Signals and dependency injection system. This service allows you to easily connect to an RSocket server, handle streams and messages, and manage authentication tokens flexibly via a token provider.

### Features

	-	RSocket Integration: Seamlessly integrate RSocket communication into your Angular application.
	-	Angular Signals: Utilize Angular’s reactive Signal system for real-time data updates.
	-	Flexible Token Management: Provide authentication tokens via configuration or a custom TokenProvider.
	-	Automatic Reconnection: Configurable automatic reconnection logic with retry attempts and delays.
	-	Dependency Injection: Leverage Angular’s DI system to manage services and tokens.

### Installation

To install the Angular RSocket Service, simply run:

```bash
npm install @michaeldatastic/angular-rsocket
```

### Usage


1. Configuration

In your application’s configuration, provide the RSocket service using the provideRSocket function. This function allows you to specify the RSocket connection configuration and an optional custom token provider.
```typescript
// app.config.ts

import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideZoneChangeDetection } from '@angular/core';
import { provideRSocket } from 'your-angular-rsocket-package';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideRSocket({
      url: 'ws://localhost:8080/rsocket',
      // Other optional configurations can be specified here
    }),
  ],
};

```

2. Injecting and Using the RSocket Service in a Custom Service

It’s recommended to handle subscriptions and data sharing in your own services. This allows you to control how subscriptions are managed and whether they are reused or not.

```typescript
// board-updates.service.ts

import { Injectable } from '@angular/core';
import { RSocketService } from 'your-angular-rsocket-package';
import { Signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class BoardUpdatesService {
  public updates$: Signal<any[] | null>;

  constructor(private rsocketService: RSocketService) {
    // Create a subscription to the 'board.updates' stream
    this.updates$ = this.rsocketService.requestStream<any>('board.updates');
  }
}
```

3. Using the Custom Service in a Component

Finally, you can use your custom service in a component to display real-time updates from the RSocket server.

```typescript
// app.component.ts

import { Component, effect, inject } from '@angular/core';
import { BoardUpdatesService } from './board-updates.service';
import { Signal } from '@angular/core';

@Component({
  selector: 'app-root',
  template: `
    <div *ngIf="updates$()">
      <div *ngFor="let item of updates$()">
        <!-- Display your streamed data here -->
        {{ item | json }}
      </div>
    </div>
  `,
})
export class AppComponent {
  private boardUpdatesService: BoardUpdatesService = inject(BoardUpdatesService);
  updates$: Signal<any[] | null>;

  constructor() {
    this.updates$ = this.boardUpdatesService.updates$;

    effect(() => {
      console.log('Received Stream Data:', this.updates$());
    });
  }
}
```

4. Passing an Authentication Token

If your RSocket server requires authentication, you can provide a token in the configuration:

```typescript
provideRSocket({
url: 'ws://localhost:8080/rsocket',
token: 'your-authentication-token',
});
```


For more advanced token management, such as retrieving tokens from an authentication service or handling token refresh logic, you can provide a custom TokenProvider.
First, create a custom token provider by implementing the AngularRSocketTokenProvider interface:

```typescript
// Interface

export interface AngularRSocketTokenProvider {
  getToken(): string | Signal<string> | null;
}
```


```typescript
// custom-token-provider.ts

import { Injectable, inject } from '@angular/core';
import { AngularRSocketTokenProvider } from 'your-angular-rsocket-package';
import { AuthService } from './auth.service';
import { Signal, signal, effect } from '@angular/core';

@Injectable()
export class CustomTokenProvider implements AngularRSocketTokenProvider {
  private authService: AuthService = inject(AuthService);
  private tokenSignal: Signal<string>;

  constructor() {
    // Initialize the token signal with the current token
    this.tokenSignal = signal(this.authService.getToken());

    // Update the token signal whenever the token changes
    effect(() => {
      this.tokenSignal.set(this.authService.getToken());
    });
  }

  getToken(): string | Signal<string> {
    return this.tokenSignal;
  }
}
```

Then, provide the custom token provider in your application configuration:

```typescript
// app.config.ts

import { CustomTokenProvider } from './custom-token-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    // ... other providers
    provideRSocket(
      {
        url: 'ws://localhost:8080/rsocket',
        // Other configuration options
      },
      CustomTokenProvider // Pass the custom token provider class
    ),
  ],
};
```

5. Advanced Configuration Options

The provideRSocket function accepts an AngularRSocketConfig object with the following optional properties, only url is required:

```typescript
import {IdentitySerializer, JsonSerializer} from "rsocket-core";

provideRSocket({
  url: 'ws://localhost:8080/rsocket',         // RSocket server URL *<required>*
  dataSerializer: IdentitySerializer | JsonSerializer,         // Custom data serializer
  metadataSerializer: IdentitySerializer | JsonSerializer, // Custom metadata serializer
  keepAlive: 60000,                           // Keep-alive interval in milliseconds
  lifetime: 180000,                           // Connection lifetime in milliseconds
  dataMimeType: WellKnownMimeType.APPLICATION_JSON,  // Data MIME type
  metadataMimeType: WellKnownMimeType.MESSAGE_RSOCKET_COMPOSITE_METADATA, // Metadata MIME type
  maxReconnectAttempts: 5,                    // Max reconnection attempts
  reconnectDelay: 2000,                       // Delay between reconnection attempts in milliseconds
  token: 'your-authentication-token',         // Authentication token (string or Signal)
});
```

6. Managing Subscriptions

Since this is a library, it’s up to you to decide how to manage subscriptions and whether to reuse them. If you call requestStream multiple times with the same route, each call will create a new subscription to the RSocket stream.

**Important Note**: Multiple subscriptions to the same route can lead to increased server load and redundant data processing. If you want to reuse subscriptions, consider managing them in a shared service, as shown in the example above.

7. Handling Disconnections

The RSocketService automatically attempts to reconnect based on the configuration. You can also manually disconnect by calling the disconnect method.

```typescript
// In your custom service or component
this.rsocketService.disconnect();
```

**Note**: Be cautious when manually disconnecting, as it will affect all components using the shared RSocketService instance.

8. Additional Methods

The RSocketService provides several methods for different interaction models:

	•	requestStream<T>(route: string, data?: any, requestItems?: number): WritableSignal<T[] | null>
	•	requestResponse<T>(route: string, data: any): WritableSignal<T | null>
	•	fireAndForget(route: string, data: any): void
	•	channel<T>(route: string, dataIterable: Iterable<any>, requestItems?: number): WritableSignal<T | null>


9. Example: Using requestResponse in a Custom Service

```typescript
// data-service.ts

import { Injectable } from '@angular/core';
import { RSocketService } from 'your-angular-rsocket-package';
import { Signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class DataService {
  constructor(private rsocketService: RSocketService) {}

  getData(): Signal<any | null> {
    return this.rsocketService.requestResponse<any>('your.route', { some: 'data' });
  }
}
```

```typescript
// component.ts

import { Component, effect } from '@angular/core';
import { DataService } from './data-service';
import { Signal } from '@angular/core';

@Component({
  selector: 'app-data',
  template: `
    <div *ngIf="data$()">
      <!-- Display your data here -->
      {{ data$() | json }}
    </div>
  `,
})
export class DataComponent {
  data$: Signal<any | null>;

  constructor(private dataService: DataService) {
    this.data$ = this.dataService.getData();

    effect(() => {
      console.log('Received Response Data:', this.data$());
    });
  }
}
```

### License

This project is licensed under the MIT License - see the LICENSE file for details.

