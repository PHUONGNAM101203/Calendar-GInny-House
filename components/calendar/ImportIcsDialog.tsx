"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LinkIcon, UploadIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveColor } from "@/lib/calendar";
import { MAX_ICS_TEXT_LENGTH } from "@/lib/validations/ics-import";
import { importIcsAction, type IcsImportReport } from "@/actions/ics-import";
import type { CustomCalendar } from "@/types";

// "Lịch khác" → "+" → "Nhập từ URL / file". A one-shot import: events are
// copied into the chosen calendar and nothing remembers where they came from,
// so importing the same source twice duplicates them. The dialog says so
// rather than hiding it, because that is the surprising half of the behaviour.
//
// Only calendars the viewer owns are offered — importIcsAction rejects anyone
// else's, and a subscribed colleague's calendar is read-only by design (0081).
export default function ImportIcsDialog({
  open,
  onOpenChange,
  calendars,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendars: CustomCalendar[];
}) {
  const [calendarId, setCalendarId] = useState(calendars[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setUrl("");
    setFileName("");
    setFileText("");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function describe(report: IcsImportReport): string {
    const notes: string[] = [];
    if (report.truncated) notes.push(`chỉ lấy trong ${report.horizonMonths} tháng tới`);
    if (report.unsupportedRecurrence > 0) {
      notes.push(`${report.unsupportedRecurrence} lịch lặp phức tạp chỉ lấy buổi đầu`);
    }
    if (report.skipped > 0) notes.push(`bỏ qua ${report.skipped} sự kiện thiếu ngày`);
    return notes.length > 0
      ? `Đã nhập ${report.imported} sự kiện (${notes.join(", ")}).`
      : `Đã nhập ${report.imported} sự kiện.`;
  }

  function submit(payload: Parameters<typeof importIcsAction>[0]) {
    setError(null);
    startTransition(async () => {
      const result = await importIcsAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(describe(result.data));
      reset();
      onOpenChange(false);
    });
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // Checked here as well as on the server so a large file is refused before
    // it is read into memory and posted.
    if (file.size > MAX_ICS_TEXT_LENGTH) {
      setError("File lịch quá lớn (tối đa 5MB).");
      setFileName("");
      setFileText("");
      return;
    }
    try {
      setFileText(await file.text());
      setFileName(file.name);
      setError(null);
    } catch {
      setError("Không đọc được file này.");
    }
  }

  const noCalendars = calendars.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nhập lịch từ URL hoặc file</DialogTitle>
          <DialogDescription>
            Hỗ trợ file .ics từ Google Calendar, Outlook và các ứng dụng lịch khác. Sự kiện được
            sao chép một lần vào lịch bạn chọn — nhập lại cùng một nguồn sẽ tạo thêm bản sao.
          </DialogDescription>
        </DialogHeader>

        {noCalendars ? (
          <p className="text-sm text-muted-foreground">
            Bạn chưa có lịch cá nhân nào. Hãy tạo một lịch ở mục &ldquo;Tạo lịch mới&rdquo; phía
            trên, rồi quay lại đây để nhập sự kiện vào lịch đó.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ics-calendar">Nhập vào lịch</Label>
              <Select value={calendarId} onValueChange={setCalendarId}>
                <SelectTrigger id="ics-calendar" className="w-full">
                  <SelectValue placeholder="Chọn lịch" />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((calendar) => (
                    <SelectItem key={calendar.id} value={calendar.id}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: resolveColor(calendar.color) }}
                        />
                        {calendar.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Tabs defaultValue="url">
              <TabsList className="w-full">
                <TabsTrigger value="url" className="flex-1 gap-1.5">
                  <LinkIcon className="size-3.5" />
                  Đường dẫn
                </TabsTrigger>
                <TabsTrigger value="file" className="flex-1 gap-1.5">
                  <UploadIcon className="size-3.5" />
                  Tải file
                </TabsTrigger>
              </TabsList>

              <TabsContent value="url" className="pt-3">
                {/* A real <form> rather than an onKeyDown handler: Enter in a
                    single-input form is native browser behaviour, and routing
                    through submit also picks up the disabled-button guard and
                    the implicit-submission accessibility semantics for free. */}
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit({ source: "url", calendar_id: calendarId, url: url.trim() });
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="ics-url">Đường dẫn .ics</Label>
                    <Input
                      id="ics-url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://calendar.google.com/.../basic.ics"
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isPending || !url.trim() || !calendarId}
                  >
                    {isPending ? "Đang nhập…" : "Nhập từ đường dẫn"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="file" className="pt-3">
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit({ source: "file", calendar_id: calendarId, text: fileText });
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="ics-file">File .ics</Label>
                    <Input
                      id="ics-file"
                      ref={fileInputRef}
                      type="file"
                      accept=".ics,text/calendar"
                      onChange={handleFileChange}
                    />
                    {fileName && (
                      <p className="text-xs text-muted-foreground">Đã chọn: {fileName}</p>
                    )}
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isPending || !fileText || !calendarId}
                  >
                    {isPending ? "Đang nhập…" : "Nhập từ file"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          {/* Explicitly type="button": shadcn's Button sets no default type, so
              inside the forms above it would inherit "submit" and close-on-Enter
              would instead fire an import. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
