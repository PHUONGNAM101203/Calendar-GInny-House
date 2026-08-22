// The corner cell above the time gutter, which react-big-calendar leaves
// empty by default (TimeGridHeader renders .rbc-label.rbc-time-header-gutter
// with no content unless components.timeGutterHeader is supplied). Google
// Calendar puts the viewer's timezone there; doing the same gives that dead
// square a job instead of just shrinking it.
//
// Static string on purpose: the app is Vietnam-only (Asia/Ho_Chi_Minh) and
// Vietnam has had no DST since 1975, so there is nothing to compute at
// runtime — and computing it would make the label disagree with the rest of
// the app the moment someone opens the calendar from another timezone.
//
// Only mounted by TimeGridHeader, i.e. week and day view; month and agenda
// have no time gutter and never render this.
export default function CalendarTimeGutterHeader() {
  return (
    <div className="flex h-full items-end justify-center pb-1 text-[0.6rem] font-medium text-muted-foreground">
      GMT+7
    </div>
  );
}
