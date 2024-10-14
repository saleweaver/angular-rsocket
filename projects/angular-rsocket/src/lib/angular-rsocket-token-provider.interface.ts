import {Signal} from '@angular/core';

export interface AngularRSocketTokenProvider {
  getToken(): string | Signal<string> | null;
}

