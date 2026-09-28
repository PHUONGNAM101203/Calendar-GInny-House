-- Lịch sử đổi ca: thu về đúng người trong cuộc và cấp quản lý của họ.
--
-- Policy cũ mở bằng vế "cùng cơ sở là đọc được", áp cho MỌI vai trò. Hậu quả
-- là một quản sinh mở /swaps thấy toàn bộ đơn đổi ca đã xử lý của cả cơ sở,
-- kèm lời nhắn riêng giữa hai người ("Dung ơi em làm hộ c nhá..."). Trang đó
-- không lọc gì thêm ở tầng ứng dụng — nó hiển thị đúng những gì RLS trả về,
-- nên vế này chính là toàn bộ chính sách hiển thị.
--
-- Mô hình đúng đã có sẵn trong can_view_profile_calendar(): chính mình, hoặc
-- TGĐ/Kỹ thuật, hoặc quản lý có quyền với vai trò của người đó. Chỉ cần bỏ vế
-- "cùng cơ sở" là ba tầng Kỹ-thuật/TGĐ → quản lý → nhân viên tự hình thành.
--
-- NGOẠI LỆ BẮT BUỘC phải chừa: đơn "nhường ca (mở)" CÒN ĐANG CHỜ người nhận
-- thì cả cơ sở vẫn phải thấy. Đó là cơ chế "ai nhận trước thì nhận" — siết
-- luôn vế này thì không ai nhìn thấy ca được nhường, và tính năng chết lặng.
-- Giới hạn đúng vào đơn đang chờ và chưa có người nhận cụ thể: nhường ca đã
-- xử lý xong thì không còn lý do gì để cả cơ sở đọc được nữa.
drop policy if exists swaps_select_branch on public.shift_swap_requests;

create policy swaps_select_branch on public.shift_swap_requests
for select using (
  requester_id = auth.uid()
  or target_id = auth.uid()
  or (
    status = 'pending'
    and target_id is null
    and public.is_branch_member(auth.uid(), branch_id)
  )
  or public.can_view_profile_calendar(requester_id)
  or (target_id is not null and public.can_view_profile_calendar(target_id))
);
