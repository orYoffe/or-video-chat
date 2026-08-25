import { expect, test } from "playwright/test";

async function installBrowserStubs(page, mediaResult = "success") {
  await page.addInitScript(({ mediaResult }) => {
    const writes = [];
    const authUser = { uid: "e2e-user" };

    function snapshot(value) {
      return { val: () => value };
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

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__e2eMediaCalls = (window.__e2eMediaCalls || 0) + 1;
          if (mediaResult !== "success") {
            const error = new DOMException("Permission denied", mediaResult);
            throw error;
          }
          return { getTracks: () => [] };
        },
      },
    });
  }, { mediaResult });
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
});
