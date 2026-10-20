import { useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';

export default function FeedbackPage() {
  const { eventId } = useParams();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    overall_rating: 5,
    service_rating: null,
    venue_rating: null,
    food_rating: null,
    comment: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.submitFeedback({ ...form, event_id: Number(eventId) });
      setSubmitted(true);
      toast.success('Thank you for your feedback!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-8 max-w-md w-full text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg className="w-10 h-10 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold">Thank you!</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">Your feedback helps us improve future events.</p>
        </div>
      </div>
    );
  }

  const StarRating = ({ value, onChange, label }) => (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            className={`text-2xl transition-colors ${star <= (value || 0) ? 'text-yellow-400' : 'text-gray-300'}`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-10">
      <div className="card p-6 max-w-md w-full space-y-5">
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)]">Event Feedback</p>
          <h1 className="text-2xl font-bold tracking-tight">How was your experience?</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">Your feedback helps us improve</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <StarRating
            label="Overall experience *"
            value={form.overall_rating}
            onChange={(v) => setForm({ ...form, overall_rating: v })}
          />
          <StarRating
            label="Service"
            value={form.service_rating}
            onChange={(v) => setForm({ ...form, service_rating: v })}
          />
          <StarRating
            label="Venue"
            value={form.venue_rating}
            onChange={(v) => setForm({ ...form, venue_rating: v })}
          />
          <StarRating
            label="Food & drinks"
            value={form.food_rating}
            onChange={(v) => setForm({ ...form, food_rating: v })}
          />
          <div>
            <label className="block text-sm font-medium mb-2">Additional comments (optional)</label>
            <textarea
              className="input w-full text-sm"
              rows={4}
              maxLength={500}
              placeholder="Tell us more about your experience..."
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">{form.comment.length}/500 characters</p>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary btn-lg w-full text-base py-3"
          >
            {submitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </form>
      </div>
    </div>
  );
}
