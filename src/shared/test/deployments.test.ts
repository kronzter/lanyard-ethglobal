import { describe, expect, it } from "vitest";
import rabdiJson from "../../../deployments/rabdi.json";
import sepoliaJson from "../../../deployments/sepolia.json";
import { configHash } from "../config/hash";
import type { EventConfigInput } from "../config/schema";
import { measured } from "../config/unmeasured";
import { validateEventConfig } from "../config/validate";
import {
  DeploymentError,
  parseRabdiDeployment,
  parseSepoliaDeployment,
  requireLive,
} from "../deployments/load";
import { eventConfig, eventConfigInput } from "../event.config";
import { isAppOrigin, parseWebUrl } from "../url";

const RESET_RABDI = `0x${"2".repeat(64)}`;
const RABDI_GENESIS = "0xa65a2b9e25129f0e8ccdf494dfd66ec744bdf400c806b832b1da86b0b939cbce";
const RESET_SEPOLIA = `0x${"1".repeat(64)}`;
const ADDR = "0x00000000000000000000000000000000000000aa";

const liveRabdi = (funding: object = { profile: "faucet-contract", faucet: ADDR }) => ({
  network: "rabdi",
  chainId: 7794095,
  mode: "live",
  resetId: RESET_RABDI,
  deployedAtBlock: "123",
  funding,
});
const liveSepolia = (patch: object = {}) => ({
  network: "sepolia",
  chainId: 11155111,
  mode: "live",
  resetId: RESET_SEPOLIA,
  deployedAtBlock: "9000000",
  publicAppOrigin: "https://mumbai2026.lanyard.example",
  contracts: { LanyardRegistrar: ADDR },
  ...patch,
});
const measuredConfig = () => {
  const c = structuredClone(eventConfigInput) as EventConfigInput;
  c.chains.rabdi.resetId = measured(RESET_RABDI, "test");
  c.chains.sepolia.resetId = measured(RESET_SEPOLIA, "test");
  c.fundingProfile = measured("faucet-contract", "test");
  return validateEventConfig(c);
};

describe("committed deployment files", () => {
  it("keep Sepolia a mock placeholder until A1 deploys", () => {
    expect(parseSepoliaDeployment(sepoliaJson).mode).toBe("mock");
    expect(() => requireLive(parseSepoliaDeployment(sepoliaJson), measuredConfig())).toThrow(
      /mock placeholder/,
    );
  });

  it("make Rabdi live with the desk wallet, matching the measured edition config", () => {
    const rabdi = parseRabdiDeployment(rabdiJson);
    const live = requireLive(rabdi, eventConfig);
    expect(live.resetId).toBe(RABDI_GENESIS);
    expect(live.funding).toEqual({
      profile: "desk-wallet",
      deskWallet: "0x6f383cb1a6770386c81e66ea0373436280ad6e16",
    });
  });
});

describe("live deployments", () => {
  it("parse with bigint blocks and lowercase addresses", () => {
    const d = parseRabdiDeployment(
      liveRabdi({ profile: "faucet-contract", faucet: ADDR.toUpperCase().replace("0X", "0x") }),
    );
    expect(d.mode === "live" && d.deployedAtBlock).toBe(123n);
    expect(d.mode === "live" && d.funding.profile === "faucet-contract" && d.funding.faucet).toBe(ADDR);
    expect(requireLive(d, measuredConfig()).network).toBe("rabdi");
    expect(requireLive(parseSepoliaDeployment(liveSepolia()), measuredConfig()).publicAppOrigin).toBe(
      "https://mumbai2026.lanyard.example",
    );
  });

  it("match the measured Rabdi identity and desk-wallet funding in the event config", () => {
    const desk = eventConfig.authorities.desk!;
    const rabdi = { ...liveRabdi({ profile: "desk-wallet", deskWallet: desk }), resetId: RABDI_GENESIS };
    expect(requireLive(parseRabdiDeployment(rabdi), eventConfig).network).toBe("rabdi");
    expect(() =>
      requireLive(
        parseRabdiDeployment({
          ...liveRabdi({ profile: "desk-wallet", deskWallet: ADDR }),
          resetId: RABDI_GENESIS,
        }),
        eventConfig,
      ),
    ).toThrow(/desk wallet .* does not match config authorities\.desk/);
    expect(() =>
      requireLive(parseRabdiDeployment({ ...liveRabdi(), resetId: RABDI_GENESIS }), eventConfig),
    ).toThrow(/funding profile faucet-contract does not match the config \(desk-wallet\)/);
    expect(() =>
      requireLive(parseRabdiDeployment(liveRabdi({ profile: "desk-wallet", deskWallet: ADDR })), eventConfig),
    ).toThrow(/reset identity .* does not match/);
  });

  it("freeze the edition config once every gate is measured", () => {
    expect(configHash(eventConfig)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it.each([
    [
      "a zero faucet address",
      () => parseRabdiDeployment(liveRabdi({ profile: "faucet-contract", faucet: `0x${"0".repeat(40)}` })),
      /zero address/,
    ],
    [
      "a faucet address under the desk-wallet profile",
      () => parseRabdiDeployment(liveRabdi({ profile: "desk-wallet", deskWallet: ADDR, faucet: ADDR })),
      /faucet/,
    ],
    [
      "a desk-wallet profile without its wallet",
      () => parseRabdiDeployment(liveRabdi({ profile: "desk-wallet" })),
      /deskWallet/,
    ],
    ["a wrong chain ID", () => parseRabdiDeployment({ ...liveRabdi(), chainId: 1 }), /chainId/],
    [
      "an http origin",
      () => parseSepoliaDeployment(liveSepolia({ publicAppOrigin: "http://localhost:8081" })),
      /https origin/,
    ],
    [
      "an origin with a path",
      () => parseSepoliaDeployment(liveSepolia({ publicAppOrigin: "https://x.example/app" })),
      /https origin/,
    ],
    [
      "a zero contract address",
      () => parseSepoliaDeployment(liveSepolia({ contracts: { LanyardRegistrar: `0x${"0".repeat(40)}` } })),
      /zero address/,
    ],
    ["no contracts", () => parseSepoliaDeployment(liveSepolia({ contracts: {} })), /lists its contracts/],
  ])("reject %s", (_name, parse, message) => {
    expect(parse).toThrow(DeploymentError);
    expect(parse).toThrow(message);
  });

  it("reject a reset identity that differs from the config", () => {
    const d = parseRabdiDeployment({ ...liveRabdi(), resetId: `0x${"9".repeat(64)}` });
    expect(() => requireLive(d, measuredConfig())).toThrow(/reset identity .* does not match/);
  });

  it("reject a funding profile that differs from the config", () => {
    const d = parseRabdiDeployment(liveRabdi({ profile: "desk-wallet", deskWallet: ADDR }));
    expect(() => requireLive(d, measuredConfig())).toThrow(/funding profile desk-wallet does not match/);
  });
});

describe("url helpers", () => {
  it("accept https origins and localhost only when allowed", () => {
    expect(isAppOrigin("https://lanyard.example", { allowLocalhost: false })).toBe(true);
    expect(isAppOrigin("https://lanyard.example:8443", { allowLocalhost: false })).toBe(true);
    expect(isAppOrigin("http://localhost:8081", { allowLocalhost: true })).toBe(true);
    expect(isAppOrigin("http://localhost:8081", { allowLocalhost: false })).toBe(false);
    expect(isAppOrigin("http://lanyard.example", { allowLocalhost: true })).toBe(false);
  });

  it("reject credentials, odd characters and malformed hosts", () => {
    expect(parseWebUrl("https://user:pw@lanyard.example/x")).toBeNull();
    expect(parseWebUrl("https://lanyard .example")).toBeNull();
    expect(parseWebUrl("https://-bad.example")).toBeNull();
    expect(parseWebUrl("https://lanyard.example:99999")).toBeNull();
    expect(parseWebUrl("javascript:alert(1)")).toBeNull();
    expect(parseWebUrl("https://Lanyard.Example/Path?q=1")).toEqual({
      scheme: "https",
      host: "lanyard.example",
      port: null,
      rest: "/Path?q=1",
    });
  });
});
