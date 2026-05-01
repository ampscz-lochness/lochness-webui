import * as React from 'react';
import Link from 'next/link'

export default function Home() {
    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-8 border-l-4 border-indigo-500 dark:border-indigo-400">
                <h2 className="text-2xl font-bold mb-4 text-indigo-600 dark:text-indigo-400">
                    👋 Welcome to Lochness WebUI.
                </h2>

                <p className="text-lg mb-3">
                    This portal allows configuring and monitoring Lochness, a data lake builder.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6">
                    <Link href="/config" color="inherit">
                        <div className="border border-l-4 border-l-amber-400 rounded-lg p-4 hover:shadow-md transition-shadow bg-amber-50/30 dark:bg-slate-700/50 dark:border-amber-500">
                            <h3 className="text-xl mb-2 font-bold text-gray-700 dark:text-gray-300">
                                🔍 Configuration
                            </h3>
                            <p className="text-base">
                                Add / Remove data sources, and manage data lake.
                            </p>
                        </div>
                    </Link>

                    <Link href="/monitoring" color="inherit">
                        <div className="border border-l-4 border-l-teal-400 rounded-lg p-4 hover:shadow-md transition-shadow bg-teal-50/30 dark:bg-slate-700/50 dark:border-teal-500">
                            <h3 className="text-xl mb-2 font-bold text-gray-700 dark:text-gray-300">
                                📊 Real-time Monitoring
                            </h3>
                            <p className="text-base">
                                Track performance metrics and health indicators of various systems.
                            </p>
                        </div>
                    </Link>

                    <Link href="/monitoring/daytracker" color="inherit" className="md:col-span-2">
                        <div className="border border-l-4 border-l-emerald-500 rounded-lg p-4 hover:shadow-md transition-shadow bg-emerald-50/40 dark:bg-slate-700/50 dark:border-emerald-500">
                            <h3 className="text-xl mb-2 font-bold text-gray-700 dark:text-gray-300">
                                🗓️ Day Tracker
                            </h3>
                            <p className="text-base">
                                Review subject-level REDCap study events and modality timelines, including consent, screen-failure, and withdrawal status indicators.
                            </p>
                        </div>
                    </Link>
                </div>

                <p className="text-base mt-4">
                    This project is under active development. Check back for updates or contribute on <Link href="https://github.com/dheshanm/lochness-webui" target="_blank" className="font-medium underline">GitHub</Link>.
                </p>
            </div>
        </div>
    );
}
