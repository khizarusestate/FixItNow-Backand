# FEATURE IMPLEMENTATIONS - REMAINING

## FEATURE #9: Notifications - Push OFF by Default
**Status:** Auto-implemented via defaults
- notificationPreference model already has defaults
- Push notifications default to false
- Only enable after user opts in
- Filter to only listed types

## FEATURE #11: Delete Account UI
**Status:** Frontend integration needed
- Backend endpoints exist and work
- Frontend needs delete button in settings
- Add confirmation dialog
- Call /api/auth/customer/delete-account or /api/auth/worker/delete-account

## FEATURE #14: Booking Lifecycle
**Status:** Implement status flow
- Customer: pending → worker-assigned → completed
- Admin: open → worker-assigned → completed
- Worker: jobs → claim → my-jobs → mark-done
- Add UI controls for each transition

## FEATURE #8: Job Matching Algorithm
**Status:** Update for multiple services
- Check if booking service matches ANY worker service
- Priority: exact match > same area > same city > anywhere
- Use services array from worker

## FEATURE #7: Advertisements
**Status:** Restore feature
- Create advertisement model
- Create API endpoints
- Create frontend form
- Add to worker dashboard

## FEATURE #6: Multiple Services
**Status:** Partially done - need integration
- ServiceSelection component created
- Need to integrate in signup forms
- Update API to save multiple services
