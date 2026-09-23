import { Agent, fetch as undiciFetch } from "undici";

const agent = new Agent();

export function nativeFetch(input: string, init?: Parameters<typeof undiciFetch>[1]): Promise<Response> {
  return undiciFetch(input, { ...init, dispatcher: agent }) as unknown as Promise<Response>;
}
