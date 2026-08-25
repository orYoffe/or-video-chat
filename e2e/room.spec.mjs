import { expect, test } from "playwright/test";

async function installBrowserStubs(
  page,
  mediaResult = "success",
  screenShareResult = "success"
) {
  await page.addInitScript(({ mediaResult, screenShareResult }) => {
    const writes = [];
    const authUser = { uid: "e2e-user" };

    function snapshot(value) {
      return { val: () => value };
    }

    function createTrack(kind) {
      const listeners = new Map();
      return {
        kind,
        readyState: "live",
        addEventListener(event, callback) {
          const callbacks = listeners.get(event) || [];
          callbacks.push(callback);
          listeners.set(event, callbacks);
        },
        stop() {
          this.readyState = "ended";
          for (const callback of listeners.get("ended") || []) {
            callback();
          }
        },
      };
    }

    function createStream(kind, constraints = { video: true, audio: true }) {
      const tracks =
        kind === "screen"
          ? [createTrack("video")]
          : [
              ...(constraints.video ? [createTrack("video")] : []),
              ...(constraints.audio ? [createTrack("audio")] : []),
            ];
      return {
        getTracks: () => tracks,
        getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
        getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
      };
    }

    function ref(path) {
      return {
        on(event, callback) {
          if (path === "rooms/" && event === "value") {
            callback(snapshot(null));
          }
        },
        once(event, callback) {
          callback(snapshot(null));
          return Promise.resolve();
        },
        set(value) {
          writes.push({ path, value });
          return Promise.resolve();
        },
        remove(callback) {
          callback?.(null);
          return Promise.resolve();
        },
        onDisconnect() {
          return {
            remove(callback) {
              callback?.(null);
            },
          };
        },
      };
    }

    const database = { ref };
    const auth = {
      onAuthStateChanged(callback) {
        queueMicrotask(() => callback(authUser));
      },
      signInAnonymously() {
        return Promise.resolve({ user: authUser });
      },
    };

    window.__e2eRoomWrites = writes;
    window.firebase = {
      app: () => ({}),
      auth: () => auth,
      database: () => database,
    };

    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() {
        return this.__e2eSrcObject || null;
      },
      set(value) {
        this.__e2eSrcObject = value;
      },
    });

    const mediaDevices =
      mediaResult === "unsupported"
        ? undefined
        : {
            getUserMedia: async (constraints) => {
              window.__e2eMediaCalls = (window.__e2eMediaCalls || 0) + 1;
              window.__e2eMediaRequests = window.__e2eMediaRequests || [];
              window.__e2eMediaRequests.push(constraints);
              if (
                mediaResult === "split-fallback" &&
                constraints.video &&
                constraints.audio
              ) {
                const error = new DOMException("Permission denied", "NotAllowedError");
                throw error;
              }
              if (mediaResult !== "success" && mediaResult !== "split-fallback") {
                const error = new DOMException("Permission denied", mediaResult);
                throw error;
              }
              return createStream("camera", constraints);
            },
          };

    if (mediaDevices && screenShareResult !== "unsupported") {
      mediaDevices.getDisplayMedia = async () => {
        window.__e2eScreenCalls = (window.__e2eScreenCalls || 0) + 1;
        if (screenShareResult !== "success") {
          const error = new DOMException("Screen capture denied", screenShareResult);
          throw error;
        }
        return createStream("screen");
      };
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    if (mediaResult === "split-fallback") {
      Object.defineProperty(navigator.permissions, "query", {
        configurable: true,
        value: async ({ name }) => ({
          state: name === "camera" ? "granted" : "prompt",
        }),
      });
    }
  }, { mediaResult, screenShareResult });
}

test.describe("room joining", () => {
  test("can start a room and reach the explicit join step", async ({ page }) => {
    await installBrowserStubs(page);
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Start a new room" })).toBeVisible();
    await page.getByRole("button", { name: "Start a new room" }).click();

    await expect(page).toHaveURL(/\/room-\d+$/);
    await expect(
      page.getByRole("button", { name: /Join room \(allow camera and microphone\)/ })
    ).toBeVisible();
  });

  test("shows a useful error and stays in the room when media access is denied", async ({ page }) => {
    await installBrowserStubs(page, "NotAllowedError");
    await page.goto("/room-e2e-denied");

    const joinButton = page.getByRole("button", {
      name: /Join room \(allow camera and microphone\)/,
    });
    await joinButton.click();

    await expect(page.getByRole("alert")).toHaveText(/Camera and microphone access was blocked/);
    await expect(page).toHaveURL(/\/room-e2e-denied$/);
    await expect(joinButton).toBeEnabled();
    await expect(page.getByText("Sorry we got an error")).toHaveCount(0);
  });

  test("disables joining when media access is unsupported", async ({ page }) => {
    await installBrowserStubs(page, "unsupported");
    await page.goto("/room-e2e-unsupported");

    const joinButton = page.getByRole("button", {
      name: /Join room \(allow camera and microphone\)/,
    });
    await expect(joinButton).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveText(/does not support camera and microphone access/);
  });

  test("registers the room participant after media access succeeds", async ({ page }) => {
    await installBrowserStubs(page);
    await page.goto("/room-e2e-success");

    await page
      .getByRole("button", { name: /Join room \(allow camera and microphone\)/ })
      .click();

    await expect.poll(() => page.evaluate(() => window.__e2eRoomWrites)).toContainEqual({
      path: "rooms/room-e2e-success/e2e-user",
      value: { uid: "e2e-user" },
    });
    await expect(page.locator(".join-call")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__e2eMediaCalls)).toBe(1);
  });

  test("falls back to separate camera and microphone requests on mobile", async ({ page }) => {
    await installBrowserStubs(page, "split-fallback");
    await page.goto("/room-e2e-split-permissions");

    await page
      .getByRole("button", { name: /Join room \(allow camera and microphone\)/ })
      .click();

    await expect(page.locator(".join-call")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__e2eMediaRequests)).toEqual([
      { video: true, audio: true },
      { video: true, audio: false },
      { video: false, audio: true },
    ]);
  });

  test("can start and stop screen sharing after joining", async ({ page }) => {
    await installBrowserStubs(page);
    await page.goto("/room-e2e-screen-share");

    await page
      .getByRole("button", { name: /Join room \(allow camera and microphone\)/ })
      .click();

    const shareButton = page.getByRole("button", { name: "Share screen" });
    await expect(shareButton).toBeVisible();
    await shareButton.click();

    await expect(page.getByRole("button", { name: "Stop sharing screen" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__e2eScreenCalls)).toBe(1);

    await page.getByRole("button", { name: "Stop sharing screen" }).click();
    await expect(page.getByRole("button", { name: "Share screen" })).toBeVisible();
  });

  test("disables screen sharing when the browser does not support it", async ({ page }) => {
    await installBrowserStubs(page, "success", "unsupported");
    await page.goto("/room-e2e-screen-unsupported");

    await page
      .getByRole("button", { name: /Join room \(allow camera and microphone\)/ })
      .click();

    const shareButton = page.getByRole("button", { name: "Screen sharing unavailable" });
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toBeDisabled();
  });
});
