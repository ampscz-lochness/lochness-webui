import { getFormsConnection } from "@/lib/formsdb";

export type SubjectStatusFlags = {
    is_screen_failed: boolean;
    is_withdrawn: boolean;
    screen_fail_reason: string | null;
    screen_fail_comments: string | null;
};

type StatusRow = {
    subject_id: string;
    form_data: Record<string, unknown> | null;
};

const isTruthyStatus = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
};

export async function getStatusFlagsBySubject(
    projectId: string,
    subjectIds: string[]
): Promise<Map<string, SubjectStatusFlags>> {
    const bySubject = new Map<string, SubjectStatusFlags>();
    if (subjectIds.length === 0) return bySubject;

    const connection = getFormsConnection();
    const result = await connection.query(
        `
        SELECT DISTINCT ON (rf.subject_id)
            rf.subject_id,
            rf.form_data
        FROM forms.redcap_forms rf
        JOIN public.subjects s ON s.subject_id = rf.subject_id
        JOIN public.sites si ON si.site_id = s.site_id
        WHERE si.project_id = $1
          AND rf.subject_id = ANY($2::text[])
          AND rf.form_name = 'status_form'
        ORDER BY rf.subject_id, COALESCE(rf.form_instance_number, 0) DESC
        `,
        [projectId, subjectIds]
    );

    for (const row of result.rows as StatusRow[]) {
        const form = row.form_data ?? {};
        const screenFailReason =
            (form["chrstatus_screenfail_reason"] as string | undefined) ??
            (form["chrstatus_reason"] as string | undefined) ??
            null;
        const screenFailComments =
            (form["chrstatus_sf_comments"] as string | undefined) ??
            (form["chrstatus_comments"] as string | undefined) ??
            null;

        bySubject.set(row.subject_id, {
            is_screen_failed: isTruthyStatus(form["chrstatus_screenfail"]),
            is_withdrawn: isTruthyStatus(form["chrstatus_withdrawal"]),
            screen_fail_reason: screenFailReason,
            screen_fail_comments: screenFailComments,
        });
    }

    return bySubject;
}
