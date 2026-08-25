// static/native.js -- the iOS shell's camera bridge (RepCheckNative).
//
// The stakes are lopsided. Almost every RepCheck user is in a browser,
// where this file must do nothing except click the same hidden <input> the
// call sites clicked before it existed. A regression on the native path
// costs a rejected build; a regression on the web path costs every user
// their food logging. So the browser-fallback cases below are the ones
// worth reading first, and they outnumber the native ones deliberately.
//
// Everything is driven through a fake window.Capacitor rather than a real
// plugin, because the contract that actually matters is "what does this do
// when the shell is absent, present, or half-configured".

import { describe, it, expect, vi } from "vitest";
import { loadNative, fakeCapacitor, blobFetch } from "./support/loadNative.js";

function photoBlob(type = "image/jpeg") {
  return new Blob([new Uint8Array([1, 2, 3])], { type });
}

describe("RepCheckNative in a plain browser", () => {
  it("reports itself as not native", () => {
    const { native } = loadNative();

    expect(native.isNative()).toBe(false);
    expect(native.platform()).toBe("web");
  });

  it("openCamera clicks the hidden input instead of doing anything native", async () => {
    const { native } = loadNative();
    const input = { click: vi.fn() };
    const onFile = vi.fn();

    await native.openCamera(input, onFile);

    expect(input.click).toHaveBeenCalledTimes(1);
    // The input's own change listener is what delivers the file on the web
    // -- calling onFile here too would double-log the meal.
    expect(onFile).not.toHaveBeenCalled();
  });

  it("openLibrary clicks the hidden input too", async () => {
    const { native } = loadNative();
    const input = { click: vi.fn() };

    await native.openLibrary(input, vi.fn());

    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it("pickImage resolves null rather than throwing", async () => {
    const { native } = loadNative();

    await expect(native.pickImage({ source: "camera" })).resolves.toBeNull();
  });

  it("haptic is a silent no-op", () => {
    const { native } = loadNative();

    expect(() => native.haptic("MEDIUM")).not.toThrow();
  });
});

describe("RepCheckNative inside the shell", () => {
  function shellWithCamera(getPhoto) {
    return fakeCapacitor({ plugins: { Camera: { getPhoto } } });
  }

  it("reports the platform", () => {
    const { native } = loadNative({ capacitor: fakeCapacitor({ platform: "ios" }) });

    expect(native.isNative()).toBe(true);
    expect(native.platform()).toBe("ios");
  });

  it("opens the real camera and hands the call site a File", async () => {
    const getPhoto = vi.fn().mockResolvedValue({ webPath: "capacitor://photo/1", format: "jpeg" });
    const { native } = loadNative({
      capacitor: shellWithCamera(getPhoto),
      fetch: blobFetch(photoBlob()),
    });
    const input = { click: vi.fn() };
    const onFile = vi.fn();

    await native.openCamera(input, onFile);

    expect(getPhoto).toHaveBeenCalledTimes(1);
    expect(input.click).not.toHaveBeenCalled();
    expect(onFile).toHaveBeenCalledTimes(1);
    const file = onFile.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("image/jpeg");
  });

  it("asks for the camera or the library depending on the entry point", async () => {
    const getPhoto = vi.fn().mockResolvedValue({ webPath: "capacitor://photo/1", format: "jpeg" });
    const { native } = loadNative({
      capacitor: shellWithCamera(getPhoto),
      fetch: blobFetch(photoBlob()),
    });

    await native.openCamera(null, vi.fn());
    await native.openLibrary(null, vi.fn());

    expect(getPhoto.mock.calls[0][0].source).toBe("CAMERA");
    expect(getPhoto.mock.calls[1][0].source).toBe("PHOTOS");
  });

  it("never edits or saves a copy of the photo", async () => {
    // Progress photos are of the user's body. Silently dropping a copy into
    // their camera roll is a privacy surprise, and a crop step is friction
    // before an AI estimate that does not need it.
    const getPhoto = vi.fn().mockResolvedValue({ webPath: "capacitor://photo/1", format: "jpeg" });
    const { native } = loadNative({
      capacitor: shellWithCamera(getPhoto),
      fetch: blobFetch(photoBlob()),
    });

    await native.openCamera(null, vi.fn());

    expect(getPhoto.mock.calls[0][0].allowEditing).toBe(false);
    expect(getPhoto.mock.calls[0][0].saveToGallery).toBe(false);
    expect(getPhoto.mock.calls[0][0].correctOrientation).toBe(true);
  });

  it("names the file by the format the camera actually returned", async () => {
    const getPhoto = vi.fn().mockResolvedValue({ webPath: "capacitor://photo/1", format: "png" });
    const { native } = loadNative({
      capacitor: shellWithCamera(getPhoto),
      fetch: blobFetch(photoBlob("image/png")),
    });
    const onFile = vi.fn();

    await native.openCamera(null, onFile);

    expect(onFile.mock.calls[0][0].name).toBe("photo.png");
  });
});

describe("RepCheckNative when things go wrong in the shell", () => {
  it("a cancelled camera yields no file and does NOT reopen a web picker", async () => {
    // Falling through to input.click() after a native cancel would stack a
    // second picker on top of the one the user just dismissed.
    const getPhoto = vi.fn().mockRejectedValue(new Error("User cancelled photos app"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Camera: { getPhoto } } }),
    });
    const input = { click: vi.fn() };
    const onFile = vi.fn();

    const result = await native.openCamera(input, onFile);

    expect(result).toBeNull();
    expect(onFile).not.toHaveBeenCalled();
    expect(input.click).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled(); // cancelling is the feature working
    warn.mockRestore();
  });

  it("a real camera failure is logged but still resolves null", async () => {
    const getPhoto = vi.fn().mockRejectedValue(new Error("camera unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Camera: { getPhoto } } }),
    });

    await expect(native.openCamera(null, vi.fn())).resolves.toBeNull();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a shell with the plugin missing falls back instead of throwing", async () => {
    // package.json can list a plugin that was never synced into the Xcode
    // project. That must degrade, not crash the food logger.
    const { native } = loadNative({ capacitor: fakeCapacitor({ plugins: {} }) });

    await expect(native.pickImage({ source: "camera" })).resolves.toBeNull();
  });

  it("a photo with no usable path yields null", async () => {
    const getPhoto = vi.fn().mockResolvedValue({ format: "jpeg" });
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Camera: { getPhoto } } }),
    });

    await expect(native.openCamera(null, vi.fn())).resolves.toBeNull();
  });

  it("an unreadable capture is logged and yields null", async () => {
    const getPhoto = vi.fn().mockResolvedValue({ webPath: "capacitor://photo/1", format: "jpeg" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Camera: { getPhoto } } }),
      fetch: () => Promise.reject(new Error("gone")),
    });

    await expect(native.openCamera(null, vi.fn())).resolves.toBeNull();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a haptics plugin that rejects never surfaces to the user", () => {
    const impact = vi.fn().mockRejectedValue(new Error("no taptic engine"));
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Haptics: { impact } } }),
    });

    expect(() => native.haptic()).not.toThrow();
    expect(impact).toHaveBeenCalled();
  });
});

describe("cancellation detection", () => {
  it("treats Capacitor's cancel wordings as cancellation, not failure", () => {
    const { native } = loadNative();
    const { isCancellation } = native._internals;

    expect(isCancellation(new Error("User cancelled photos app"))).toBe(true);
    expect(isCancellation(new Error("No image picked"))).toBe(true);
    expect(isCancellation(new Error("camera unavailable"))).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });
});
