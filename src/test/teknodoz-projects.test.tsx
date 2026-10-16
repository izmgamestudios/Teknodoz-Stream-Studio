import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeknodozProjects } from "@/components/TeknodozProjects";

const LIST = {
  projects: [
    { id: "open", name: "Open One", description: "", tag: "open-source", locked: false, url: "https://open.ortakofis.org/", repo: "https://github.com/o/open" },
    { id: "secret", name: "<b>Secret</b>", description: "", tag: "private", locked: true },
    { id: "bad", name: "Bad Url", description: "", tag: "open-source", locked: false, url: "javascript:alert(1)" },
  ],
};

describe("TeknodozProjects", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists open-source links, hides private urls, escapes names and drops non-https links", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(LIST)));
    const { container } = render(<TeknodozProjects current="me" />);
    expect(await screen.findByRole("link", { name: "Open One" })).toHaveAttribute("href", "https://open.ortakofis.org/");
    expect(screen.getAllByText("Açık Kaynak")).toHaveLength(2);
    expect(screen.getByText("<b>Secret</b>")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.queryByRole("link", { name: "Bad Url" })).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toContain("current=me");
  });

  it("opens a private project only after the gateway accepts the password", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(LIST)))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://secret.ortakofis.org/" })));
    render(<TeknodozProjects current="me" />);
    fireEvent.click(await screen.findByRole("button", { name: /Şifreyle aç/ }));

    fireEvent.change(screen.getByLabelText(/şifre/), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
    expect(await screen.findByText("Şifre hatalı.")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/şifre/), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://secret.ortakofis.org/", "_blank", "noopener,noreferrer"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: "secret", password: "wrong" });
  });

  it("shows a quiet error when the gateway is down", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<TeknodozProjects current="me" />);
    expect(await screen.findByText("Liste şu an yüklenemedi.")).toBeInTheDocument();
  });
});
