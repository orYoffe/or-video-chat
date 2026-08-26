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
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: () => Promise.resolve(),
    });

    const mediaDevices =
      mediaResult === "unsupported"
        ? undefined
        : {
            getUserMedia: async (constraints) => {
              window.__e2eMediaCalls = (window.__e2eMediaCalls || 0) + 1;
              window.__e2eMediaRequests = window.__e2eMediaRequests || [];
              window.__e2eMediaRequests.push(constraints);
              if (mediaResult !== "success") {
                const error = new DOMException("Permission denied", mediaResult);
                throw error;
              }
              return createStream("camera", constraints);
            },
          };

    if (mediaDevices && screenShareResult !== "unsupported") {
      mediaDevices.getDisplayMedia = async (constraints) => {
        window.__e2eScreenCalls = (window.__e2eScreenCalls || 0) + 1;
        window.__e2eScreenRequests = window.__e2eScreenRequests || [];
        window.__e2eScreenRequests.push(constraints);
        if (screenShareResult !== "success") {
          const error = new DOMException("Screen capture denied", screenShareResult);
          throw error;
        }
        return createStream("screen", constraints);
      };
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
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

  test("registers the room participant after media access succeeds", async ({ page }, testInfo) => {
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
    await expect
      .poll(() => page.evaluate(() => window.__e2eMediaCalls))
      .toBe(testInfo.project.name === "android-chromium" ? 2 : 1);
  });

  test("requests the microphone before the camera on Android", async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== "android-chromium", "Android-only permission order");
    await installBrowserStubs(page);
    await page.goto("/room-e2e-split-permissions");

    await page
      .getByRole("button", { name: /Join room \(allow camera and microphone\)/ })
      .click();

    await expect(page.locator(".join-call")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__e2eMediaRequests)).toEqual([
      { video: false, audio: true },
      { video: true, audio: false },
    ]);
  });

  test("keeps the audio unlock control after it is activated", async ({ page }) => {
    await installBrowserStubs(page);
    await page.goto("/room-e2e-audio-unlock");

    await page.evaluate(() => {
      const wrapper = document.createElement("div");
      const video = document.createElement("video");
      const overlay = document.createElement("div");
      const muteButton = document.createElement("button");
      wrapper.className = "video-wrapper";
      overlay.appendChild(muteButton);
      wrapper.append(video, overlay);
      document.querySelector(".video-call").appendChild(wrapper);
      document.querySelector(".unmute-all").style.display = "block";
    });

    await page.getByRole("button", { name: "Click to join the call" }).click();

    await expect(page.locator(".unmute-all")).toHaveCount(1);
    await expect(page.locator(".unmute-all")).toBeHidden();
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
    await expect.poll(() => page.evaluate(() => window.__e2eScreenRequests)).toEqual([
      { video: true, audio: true },
    ]);

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
