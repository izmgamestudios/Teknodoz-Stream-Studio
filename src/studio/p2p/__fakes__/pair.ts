// src/studio/p2p/__fakes__/pair.ts
// Test harness: a StudioHost and a StudioClient wired through the in-memory fake network.
import type { PeerRole } from "../../types";
import { StudioClient, type AcceptOfferOptions } from "../client";
import { StudioHost, type InviteResult, type StudioHostOptions } from "../host";
import {
  FakeDataChannel,
  FakeNetwork,
  FakePeerConnection,
  fakeRtcFactory,
  settle,
} from "./fake-rtc";

export interface Harness {
  net: FakeNetwork;
  host: StudioHost;
  newHost(options?: Partial<StudioHostOptions>): StudioHost;
}

export function makeHarness(options: Partial<StudioHostOptions> = {}): Harness {
  const net = new FakeNetwork();
  const build = (extra: Partial<StudioHostOptions>): StudioHost =>
    new StudioHost({
      usePublicStun: false,
      rtcFactory: fakeRtcFactory(net),
      origin: "https://studio.test",
      ...extra,
    });
  return { net, host: build(options), newHost: (extra = {}) => build(extra) };
}

export interface Pair {
  invite: InviteResult;
  client: StudioClient;
  answerCode: string;
  /** host-side peer connection / control channel for this invite */
  hostPc: FakePeerConnection;
  hostDc: FakeDataChannel;
  /** client-side peer connection; its channel exists once the pair is connected */
  clientPc: FakePeerConnection;
  clientDc: () => FakeDataChannel;
}

export interface PairOptions {
  /** name passed to createInvite */
  name?: string;
  /** name passed to acceptOffer */
  clientName?: string;
  /** apply the answer on the host (default true); false leaves the offer pending */
  connect?: boolean;
  /** podcast seat: audio-only invite (no video transceiver) */
  audioOnly?: boolean;
  client?: AcceptOfferOptions;
  host?: StudioHost;
}

/**
 * Invite -> accept -> (optionally) answer, strictly sequential so the newest fake peer
 * connections belong to this pair.
 */
export async function makePair(
  h: Harness,
  role: PeerRole,
  opts: PairOptions = {},
): Promise<Pair> {
  const host = opts.host ?? h.host;
  const invite = await host.createInvite(
    role,
    opts.name,
    opts.audioOnly ? { audioOnly: true } : {},
  );
  const hostPc = h.net.pcs[h.net.pcs.length - 1] as FakePeerConnection;
  const { client, answerCode } = await StudioClient.acceptOffer(invite.code, {
    rtcFactory: fakeRtcFactory(h.net),
    ...(opts.clientName !== undefined ? { name: opts.clientName } : {}),
    ...opts.client,
  });
  const clientPc = h.net.pcs[h.net.pcs.length - 1] as FakePeerConnection;
  if (opts.connect !== false) {
    await host.acceptAnswer(invite.peerId, answerCode);
    await settle();
  }
  return {
    invite,
    client,
    answerCode,
    hostPc,
    hostDc: hostPc.channels[0] as FakeDataChannel,
    clientPc,
    clientDc: () => clientPc.channels[0] as FakeDataChannel,
  };
}
